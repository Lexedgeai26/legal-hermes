"use strict"

/**
 * Create build/hermes-agent-source.zip for public desktop installers.
 *
 * The Electron desktop is a thin installer: first launch bootstraps the Python
 * Hermes/LexEdge runtime. Public builds cannot rely on a private Git remote or
 * an unpublished dirty commit, so we ship a sanitized source archive alongside
 * the app and let install.ps1 extract it on first launch.
 */

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync, spawnSync } = require("node:child_process")

const DESKTOP_ROOT = path.resolve(__dirname, "..")
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "..", "..")
const OUT_DIR = path.join(DESKTOP_ROOT, "build")
const OUT_FILE = path.join(OUT_DIR, "hermes-agent-source.zip")

const EXCLUDED_PREFIXES = [
  ".git/",
  ".venv/",
  "venv/",
  "node_modules/",
  "apps/desktop/node_modules/",
  "apps/desktop/release",
  "apps/desktop/build/",
  "apps/desktop/dist/",
  "apps/desktop/.vite/",
  "apps/desktop/.cache/",
]

const EXCLUDED_NAMES = new Set([
  ".env",
  ".env.local",
  "state.db",
  "lexedge_practice.db",
  "kanban.db",
])

function gitListFiles(args) {
  const out = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" })
  return out.split("\n").map(line => line.trim()).filter(Boolean)
}

function shouldInclude(rel) {
  const normalized = rel.replace(/\\/g, "/")
  if (!normalized || normalized.startsWith("../")) return false
  if (EXCLUDED_PREFIXES.some(prefix => normalized.startsWith(prefix))) return false
  const base = path.basename(normalized)
  if (EXCLUDED_NAMES.has(base)) return false
  if (/\.sqlite3?$/i.test(base) || /\.db$/i.test(base)) return false
  if (/\.map$/i.test(base)) return false
  return true
}

function copyFile(srcRel, stagingRoot) {
  const src = path.join(REPO_ROOT, srcRel)
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return false
  const dest = path.join(stagingRoot, "hermes-agent", srcRel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  try {
    fs.chmodSync(dest, fs.statSync(src).mode)
  } catch {
    void 0
  }
  return true
}

function main() {
  const tracked = gitListFiles(["ls-files"])
  const untracked = gitListFiles(["ls-files", "--others", "--exclude-standard"])
  const files = Array.from(new Set([...tracked, ...untracked])).filter(shouldInclude).sort()

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "lexedge-source-"))
  let copied = 0
  try {
    for (const rel of files) {
      if (copyFile(rel, staging)) copied += 1
    }

    fs.mkdirSync(OUT_DIR, { recursive: true })
    try {
      fs.rmSync(OUT_FILE, { force: true })
    } catch {
      void 0
    }

    const zip = spawnSync("zip", ["-qr", OUT_FILE, "hermes-agent"], {
      cwd: staging,
      stdio: "inherit",
    })
    if (zip.status !== 0) {
      throw new Error(`zip failed with exit ${zip.status}`)
    }

    const sizeMb = fs.statSync(OUT_FILE).size / (1024 * 1024)
    console.log(`[stage-source-archive] ${path.relative(DESKTOP_ROOT, OUT_FILE)}: ${copied} files, ${sizeMb.toFixed(1)} MB`)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

main()
