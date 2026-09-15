# MEMORY.md

Durable decisions and hard-won findings. Things that cost time to discover and
would cost it again if forgotten. Newest first.

---

## 2026-09-15 — macOS release signing

**Notarization uses an App Store Connect API key, not an Apple ID password.**
Identifiers and paths: `docs/local/signing.local.md` (git-ignored; this repo is
public).

An app-specific password authenticates a *person*, and that person must belong
to the team being submitted for. `chirag@indapoint.com` is not a member of the
signing team, so that route returns `401 Unauthenticated` — which reads as a
mistyped password and sent us round in circles. An API key authenticates the
*team*, so membership is irrelevant. Reach for the key first.

**A revoked key fails with the identical `401`, mid-build.** One build notarized
successfully and the next failed minutes later with nothing changed locally,
because the key had been revoked server-side. If notarization suddenly 401s,
check whether the key still exists before debugging anything local.

**Private keys must live outside every repository.** An Admin-scoped key was
found committed and pushed to public-facing GitLab history in two repos. It has
been revoked. Purging history does not un-expose a key — rotation is the fix;
the rewrite only stops further spread. `*.p8` is git-ignored; keep it that way.

**Stapling is not optional and is a separate step.** A notarized but unstapled
build still warns on a machine with no network, because Gatekeeper cannot reach
Apple to check the ticket.

**Homebrew's Rust cannot cross-compile.** Its rustlib carries only the host
target, so `x86_64` builds fail silently on an arm64 machine. rustup's toolchain
must come first on `PATH`. The two macOS builds are separate artifacts, not
universal — the Private AI runtime pins a different Ollama artifact per arch.

---

## 2026-09-15 — Private AI model reuse

**Catalogue membership is not negotiable.** The product tells users their models
are legally reviewed, so reuse is the intersection of "installed" and "in the
signed catalogue" — never "technically capable".

**Identity is the digest, not the tag.** Observed live: a machine held
`llama3.1:latest` whose digest matched the catalogue's `llama3.1:8b` exactly.
Tag matching would have re-downloaded 4.9 GB it already had; digest matching
recognised it. The converse matters more — a re-pointed `latest` under a
matching name must fail closed.

**Context window and tool support are independent gates.** `phi3.5` advertises
131072 context and supports no tools; `functiongemma` supports tools with a
32768 window. Inferring one from the other ships an install that provisions
cleanly and fails on the first message.

**Unknown is not a pass.** Older Ollama builds omit `capabilities` entirely.
That is not evidence of tool support and must not be treated as either answer.

**Per-model probe failures are normal.** Cloud-tagged entries answer `410`, and
a model deleted mid-scan answers `404`. One bad entry must never abort the sweep.

---

## 2026-09-15 — Installer UX

**The macOS launcher fast path is deliberate.** A bare launch of an already
installed Hermes relaunches the desktop app instead of showing setup, so the
Applications icon doubles as a launcher. `--reinstall` / `--repair` forces the
setup UI. This is regularly misread as "the installer won't start".

**Never hot-edit renderer sources during an install.** Stage titles arrive as a
one-time `manifest` event held in renderer memory; an HMR reload wipes them and
the screen sticks at "0 of 0 steps" while the install succeeds underneath. The
underlying fragility is real — the renderer cannot re-query stage state after a
reload — but in production only a webview crash would trigger it.

**Test first-run with a scratch `HERMES_HOME`.** Never delete `~/.hermes` to get
a clean state: it holds `.env` and `auth.json` with live credentials.
