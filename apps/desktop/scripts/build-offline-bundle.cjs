"use strict"

/**
 * Assemble build/offline-bundle/ -- the offline runtime asset bundle for the
 * "-offline-setup.exe" desktop installer variant. Consumed by install.ps1's
 * -OfflineBundle mode (scripts/install.ps1), which uses these assets instead
 * of downloading uv, Python, Git, Node, ripgrep, and the Python dependency
 * wheelhouse at first launch.
 *
 * This script does NOT download anything itself -- the raw assets are large
 * (~190MB) and change rarely (only on a Python/uv/Git/Node version bump), so
 * they're fetched once into build/offline-assets/raw/ (gitignored, same as
 * build/hermes-agent-source.zip) and just packaged + checksummed here on
 * every build. See scripts/offline-assets-REFRESHING.md for the exact
 * commands to re-fetch when a pinned version changes.
 *
 * Layout produced under build/offline-bundle/:
 *   manifest.json          -- sha256 + size for every asset below
 *   uv/uv.zip
 *   python/cpython-<ver>-x86_64-pc-windows-msvc-install_only_stripped.tar.gz
 *   git/PortableGit.7z.exe
 *   node/node.zip
 *   ripgrep/rg.zip
 *   wheelhouse.zip          -- win_amd64/cp311 wheels for `hermes-agent[all]`,
 *                              locked from the repo's uv.lock, zipped into a
 *                              single file. install.ps1's offline
 *                              Get-OfflineWheelhousePath extracts it before
 *                              handing the result to `uv sync --find-links`.
 *                              Zipped (not 101 loose .whl files) because
 *                              electron-builder's extraResources file walk
 *                              hit a memory wall packaging that many small
 *                              files individually -- one archive avoids it.
 */

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process")

const DESKTOP_ROOT = path.resolve(__dirname, "..")
const RAW_DIR = path.join(DESKTOP_ROOT, "build", "offline-assets", "raw")
const OUT_DIR = path.join(DESKTOP_ROOT, "build", "offline-bundle")

// Pinned versions -- MUST stay in sync with scripts/install.ps1's own pins
// ($PythonVersion, PortableGit's $gitTag, $NodeVersion) and pyproject.toml's
// requires-python floor. If you bump one there, regenerate raw/ (see
// scripts/offline-assets-REFRESHING.md) and update these before rebuilding.
const VERSIONS = {
  uv: "0.11.28",
  python: "3.11.15",
  git: "2.54.0.windows.1",
  node: "22.23.1",
  ripgrep: "14.1.1"
}

const ASSETS = [
  { key: "uv", relDir: "uv", file: "uv.zip" },
  {
    key: "python",
    relDir: "python",
    // Derived from VERSIONS.python (single source of truth) rather than a
    // second hardcoded literal -- REFRESHING.md's fetch step names the file
    // this way, so keep that convention when re-fetching a new version.
    file: `cpython-${VERSIONS.python}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`
  },
  { key: "git", relDir: "git", file: "PortableGit.7z.exe" },
  { key: "node", relDir: "node", file: "node.zip" },
  { key: "ripgrep", relDir: "ripgrep", file: "rg.zip" }
]

function sha256(filePath) {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash("sha256").update(buf).digest("hex")
}

function copyWithChecksum(relDir, file) {
  const src = path.join(RAW_DIR, relDir, file)
  if (!fs.existsSync(src)) {
    throw new Error(
      `Missing raw offline asset: ${path.relative(DESKTOP_ROOT, src)}\n` +
        `Run the fetch commands in scripts/offline-assets-REFRESHING.md first.`
    )
  }
  const destDir = path.join(OUT_DIR, relDir)
  fs.mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, file)
  fs.copyFileSync(src, dest)
  const stat = fs.statSync(dest)
  return {
    file: `${relDir}/${file}`,
    sha256: sha256(dest),
    bytes: stat.size
  }
}

function buildWheelhouseZip() {
  const srcDir = path.join(RAW_DIR, "wheelhouse")
  if (!fs.existsSync(srcDir)) {
    throw new Error(
      `Missing raw wheelhouse: ${path.relative(DESKTOP_ROOT, srcDir)}\n` +
        `Run the fetch commands in scripts/offline-assets-REFRESHING.md first.`
    )
  }
  const wheels = fs.readdirSync(srcDir).filter(f => f.endsWith(".whl"))
  if (wheels.length === 0) {
    throw new Error(`No .whl files found in ${path.relative(DESKTOP_ROOT, srcDir)}`)
  }

  const dest = path.join(OUT_DIR, "wheelhouse.zip")
  fs.rmSync(dest, { force: true })
  const zip = spawnSync("zip", ["-qr", dest, ...wheels], { cwd: srcDir, stdio: "inherit" })
  if (zip.status !== 0) {
    throw new Error(`zip failed with exit ${zip.status} while packaging the wheelhouse`)
  }

  return {
    count: wheels.length,
    entry: { file: "wheelhouse.zip", sha256: sha256(dest), bytes: fs.statSync(dest).size }
  }
}

// Generate electron-builder.offline.json from package.json's own
// build.extraResources rather than hand-maintaining a second copy --
// electron-builder's config-file merge semantics for array fields aren't
// something to bet a silently-broken installer on (an array could get
// replaced instead of merged), so this writes the FULL list explicitly,
// derived from the one source of truth, plus the offline bundle entry.
function writeOfflineBuilderConfig() {
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, "package.json"), "utf8"))
  const baseExtraResources = pkg.build && pkg.build.extraResources ? pkg.build.extraResources : []
  const config = {
    artifactName: "LexEdge-AI-${version}-${os}-${arch}-offline.${ext}",
    extraResources: [
      ...baseExtraResources,
      {
        from: "build/offline-bundle",
        to: "bootstrap/offline"
      }
    ]
  }
  const configPath = path.join(DESKTOP_ROOT, "electron-builder.offline.json")
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
  return configPath
}

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const assets = {}
  for (const { key, relDir, file } of ASSETS) {
    assets[key] = copyWithChecksum(relDir, file)
  }
  const wheelhouse = buildWheelhouseZip()
  assets.wheelhouse = wheelhouse.entry

  const manifest = {
    generatedAt: new Date().toISOString(),
    versions: VERSIONS,
    assets,
    wheelhouseCount: wheelhouse.count
  }
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2))
  const configPath = writeOfflineBuilderConfig()

  const totalBytes = Object.values(assets).reduce((sum, a) => sum + a.bytes, 0)
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(1)
  console.log(
    `[build-offline-bundle] ${path.relative(DESKTOP_ROOT, OUT_DIR)}: ` +
      `${Object.keys(assets).length} assets (incl. ${wheelhouse.count} wheels zipped), ${totalMb} MB`
  )
  console.log(`[build-offline-bundle] wrote ${path.relative(DESKTOP_ROOT, configPath)}`)
}

main()
