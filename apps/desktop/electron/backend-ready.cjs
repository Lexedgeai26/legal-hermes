const _READY_RE = /^HERMES_DASHBOARD_READY port=(\d+)/m
const { execFile } = require('node:child_process')

function detectListeningPort(pid, callback) {
  if (!pid || process.platform === 'win32') {
    callback(null)
    return
  }

  execFile(
    'lsof',
    ['-Pan', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'],
    { timeout: 2_000 },
    (error, stdout) => {
      if (error || !stdout) {
        callback(null)
        return
      }
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/\b(?:127\.0\.0\.1|localhost|\[::1\]|\*)[:.](\d+)\s+\(LISTEN\)$/)
        if (match) {
          callback(parseInt(match[1], 10))
          return
        }
      }
      callback(null)
    }
  )
}

/**
 * Watch a child process's stdout for the `HERMES_DASHBOARD_READY port=<N>`
 * line that web_server.py prints after uvicorn binds its socket.
 *
 * Returns the parsed port. Rejects if:
 *   - the child exits before emitting the line
 *   - the child emits an `error` event
 *   - no line arrives within the timeout
 *
 * A single `cleanup()` tears down every listener (data/exit/error/timeout)
 * on every terminal path — resolve, reject, or timeout — so repeated
 * backend spawns don't leak listener slots on the child.
 */
function waitForDashboardPort(child, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    let done = false

    function cleanup() {
      if (done) return
      done = true
      clearTimeout(timer)
      clearInterval(portProbe)
      child.stdout.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }

    function onData(chunk) {
      buf += chunk.toString()
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        const m = line.match(_READY_RE)
        if (m) {
          cleanup()
          resolve(parseInt(m[1], 10))
          return
        }
      }
    }

    function onExit(code, signal) {
      cleanup()
      reject(new Error(`LexEdge AI backend: exited before port announcement (${signal || code})`))
    }

    function onError(err) {
      cleanup()
      reject(err)
    }

    function probeListeningPort() {
      detectListeningPort(child.pid, port => {
        if (done || !port) return
        cleanup()
        resolve(port)
      })
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for LexEdge AI backend port announcement (${timeoutMs}ms)`))
    }, timeoutMs)
    const portProbe = setInterval(probeListeningPort, 1_000)
    if (typeof portProbe.unref === 'function') portProbe.unref()

    child.stdout.on('data', onData)
    child.on('exit', onExit)
    child.on('error', onError)
    probeListeningPort()
  })
}

module.exports = { waitForDashboardPort }
