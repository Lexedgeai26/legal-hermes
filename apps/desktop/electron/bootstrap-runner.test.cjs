const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const {
  runBootstrap,
  resolveInstallScript,
  installedAgentInstallScript,
  cachedScriptPath,
  spawnPowerShell
} = require('./bootstrap-runner.cjs')

const SCRIPT_NAME = process.platform === 'win32' ? 'install.ps1' : 'install.sh'

function mkTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-bootstrap-test-'))
}

test('runBootstrap bails immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()

  const events = []
  const result = await runBootstrap({
    installStamp: null,
    activeRoot: '/tmp/hermes-runner-test',
    sourceRepoRoot: null,
    hermesHome: '/tmp/hermes-runner-test',
    logRoot: '/tmp/hermes-runner-test',
    onEvent: ev => events.push(ev),
    abortSignal: controller.signal
  })

  // Cancelled before any install script is spawned.
  assert.deepEqual(result, { ok: false, cancelled: true })
  assert.ok(
    events.some(ev => ev.type === 'failed' && /cancelled/i.test(ev.error)),
    'should emit a cancelled failure event'
  )
})

test('installedAgentInstallScript resolves the installer in the agent checkout', () => {
  const home = mkTmpHome()
  try {
    assert.equal(installedAgentInstallScript(home), null, 'absent before the checkout exists')

    const scriptsDir = path.join(home, 'hermes-agent', 'scripts')
    fs.mkdirSync(scriptsDir, { recursive: true })
    const scriptPath = path.join(scriptsDir, SCRIPT_NAME)
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho hi\n')

    assert.equal(installedAgentInstallScript(home), scriptPath)
    assert.equal(installedAgentInstallScript(null), null, 'null home -> null')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript prefers a cached script without touching the network', async () => {
  const home = mkTmpHome()
  try {
    const commit = 'a'.repeat(40)
    const cached = cachedScriptPath(home, commit)
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, '#!/bin/sh\necho cached\n')

    const logs = []
    const result = await resolveInstallScript({
      installStamp: { commit },
      sourceRepoRoot: null,
      hermesHome: home,
      emit: ev => logs.push(ev)
    })

    assert.equal(result.source, 'cache')
    assert.equal(result.path, cached)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript falls back to the installed agent checkout on a 404', async () => {
  const home = mkTmpHome()
  try {
    const commit = 'a'.repeat(40)
    // Seed the installed agent checkout so the fallback has something to resolve.
    const scriptsDir = path.join(home, 'hermes-agent', 'scripts')
    fs.mkdirSync(scriptsDir, { recursive: true })
    const installed = path.join(scriptsDir, SCRIPT_NAME)
    fs.writeFileSync(installed, '#!/bin/sh\necho fallback\n')

    const logs = []
    const result = await resolveInstallScript({
      installStamp: { commit },
      sourceRepoRoot: null,
      hermesHome: home,
      emit: ev => logs.push(ev),
      // Simulate GitHub returning a 404 for the pinned commit.
      _download: async () => {
        throw new Error('Failed to download install.sh: HTTP 404')
      }
    })

    assert.equal(result.source, 'installed-agent')
    // It should have copied the installer into the bootstrap cache.
    assert.equal(result.path, cachedScriptPath(home, commit))
    assert.ok(fs.existsSync(result.path), 'fallback script copied into cache')
    assert.ok(
      logs.some(ev => /falling back to installed agent/.test(ev.line || '')),
      'emits a fallback log line'
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript rethrows when the 404 fallback is unavailable', async () => {
  const home = mkTmpHome()
  try {
    const commit = 'a'.repeat(40)
    // No installed agent checkout seeded -> nothing to fall back to.
    await assert.rejects(
      resolveInstallScript({
        installStamp: { commit },
        sourceRepoRoot: null,
        hermesHome: home,
        emit: () => {},
        _download: async () => {
          throw new Error('Failed to download install.sh: HTTP 404')
        }
      }),
      /HTTP 404|Failed to download/
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// Regression test for field reports of the "Node deps" stage hanging for
// hours on machines where npm/npx stalls silently (firewall/proxy/AV
// blocking the network call with no error). Uses a short idleTimeoutMs
// override so the test runs in seconds instead of the real 5-minute default.
// Windows-only: spawnPowerShell shells out to powershell.exe.
if (process.platform === 'win32') {
  function isPidAlive(pid) {
    try {
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -ne $null`],
        { encoding: 'utf8' }
      ).trim()

      return out === 'True'
    } catch {
      return false
    }
  }

  test('idle timeout kills a stalled child AND the grandchild process it spawned', async () => {
    const home = mkTmpHome()
    const scriptPath = path.join(home, 'stall.ps1')
    const markerPath = path.join(home, 'grandchild-pid.txt')

    try {
      // Mirrors real install.ps1 -> npm.cmd -> node.exe: the top-level
      // process (played here by spawnPowerShell) starts a grandchild that
      // produces no stdout/stderr and just sleeps -- a stand-in for a
      // stalled npm/npx network call. It records its own pid so the test
      // can confirm afterwards whether it's still running.
      fs.writeFileSync(
        scriptPath,
        [
          `$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 60' -PassThru -WindowStyle Hidden`,
          `Set-Content -Path '${markerPath}' -Value $p.Id`,
          `Start-Sleep -Seconds 30`
        ].join('\n')
      )

      const result = await spawnPowerShell(scriptPath, [], {
        emit: () => {},
        stageName: 'test-stage',
        // Long enough for powershell.exe's own cold-start + Start-Process to
        // finish writing the marker before the idle clock (which starts
        // ticking at spawn time) expires; still short enough to keep the
        // test fast.
        idleTimeoutMs: 4000
      })

      assert.equal(result.timedOut, true, 'result should report timedOut')

      const grandchildPid = Number(fs.readFileSync(markerPath, 'utf8').trim())
      assert.ok(grandchildPid > 0, 'grandchild pid should have been recorded')

      // Pre-fix, only the top-level powershell.exe was terminated
      // (child.kill('SIGTERM') on Windows doesn't touch descendants), so
      // this grandchild -- standing in for the actually-stalled npm/npx
      // process -- would still be running here.
      assert.equal(isPidAlive(grandchildPid), false, 'grandchild process should have been killed by the tree-kill')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  // Regression: install.ps1 marks the browser-engine (Chromium) stage
  // `optional` in its manifest specifically so its failure can never block
  // the rest of the install -- Chromium is the largest, slowest, most
  // failure-prone piece of setup. Uses a small fake install.ps1 (not the
  // real one) that supports just the -Manifest / -Stage contract, so this
  // runs in milliseconds and doesn't depend on real npm/Chromium state.
  test('an optional stage failing does not abort the rest of the bootstrap', async () => {
    const home = mkTmpHome()
    const sourceRoot = path.join(home, 'source')
    const scriptsDir = path.join(sourceRoot, 'scripts')
    fs.mkdirSync(scriptsDir, { recursive: true })

    const fakeInstallScript = `
      param(
          [switch]$Manifest,
          [string]$Stage,
          [switch]$NonInteractive,
          [switch]$Json,
          [string]$Commit,
          [string]$Branch
      )
      if ($Manifest) {
          $payload = @{
              protocol_version = 1
              stages = @(
                  @{ name = "ok-stage"; title = "OK stage"; category = "install"; needs_user_input = $false; optional = $false }
                  @{ name = "fail-stage"; title = "Optional failing stage"; category = "install"; needs_user_input = $false; optional = $true }
              )
          }
          $payload | ConvertTo-Json -Depth 5 -Compress | Write-Output
          exit 0
      }
      if ($Stage -eq "ok-stage") {
          @{ ok = $true; stage = "ok-stage"; skipped = $false } | ConvertTo-Json -Compress | Write-Output
          exit 0
      }
      if ($Stage -eq "fail-stage") {
          @{ ok = $false; stage = "fail-stage"; reason = "simulated failure" } | ConvertTo-Json -Compress | Write-Output
          exit 1
      }
    `
    fs.writeFileSync(path.join(scriptsDir, 'install.ps1'), fakeInstallScript)

    const events = []
    const result = await runBootstrap({
      installStamp: null,
      activeRoot: path.join(home, 'active'),
      sourceRepoRoot: sourceRoot,
      hermesHome: home,
      logRoot: home,
      onEvent: ev => events.push(ev),
      abortSignal: undefined,
      writeMarker: () => ({})
    })

    try {
      assert.equal(result.ok, true, 'bootstrap must succeed despite the optional stage failing')

      // Two 'stage' events fire for this stage name (running, then failed) --
      // take the last one.
      const failStageEvents = events.filter(ev => ev.type === 'stage' && ev.name === 'fail-stage')
      assert.equal(
        failStageEvents.at(-1)?.state,
        'failed',
        'the stage itself is still honestly reported as failed'
      )

      assert.ok(
        !events.some(ev => ev.type === 'failed'),
        'no top-level bootstrap "failed" event should be emitted for an optional stage'
      )
      assert.ok(
        events.some(ev => ev.type === 'complete'),
        'bootstrap should still reach "complete"'
      )
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
}
