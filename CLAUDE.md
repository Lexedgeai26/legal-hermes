# CLAUDE.md

Guidance for Claude Code working in this repository. `AGENTS.md` is the full
engineering reference; this file covers what is easy to get wrong.

## This repository is public

`github.com/Lexedgeai26/legal-hermes` is a **public** repository. Never commit
credentials, signing key identifiers, customer data, or matter content. When in
doubt, put it in `docs/local/` (git-ignored) and reference it from here.

## Release signing (macOS)

Signing and notarization identifiers are **deliberately not in this repository**.
They live in `docs/local/signing.local.md`, which is git-ignored.

What is safe to know publicly:

- The macOS installer is signed with a **Developer ID Application** certificate
  and notarized by Apple, with the ticket **stapled** so it opens offline.
- Notarization uses an **App Store Connect API key**, not an Apple ID
  app-specific password. A password authenticates a person who must belong to
  the signing team; an API key authenticates the team. The password route fails
  with a misleading `401 Unauthenticated` that looks like a typo.
- The private key (`.p8`) lives outside any repository, in
  `~/.appstoreconnect/private_keys/`, mode `0600`. `*.p8` is git-ignored — never
  relax that, and never add a key "just for CI".
- Stapling is a separate step from notarizing. A notarized but unstapled build
  still warns on a machine with no network.

Two architectures are built separately and are **not** universal
(`aarch64-apple-darwin`, `x86_64-apple-darwin`); the Private AI runtime pins a
different Ollama artifact per architecture. Homebrew's Rust ships only the host
target and cannot cross-compile — rustup's toolchain must precede it on `PATH`.

## The bootstrap installer

`apps/bootstrap-installer` (Tauri) is the *setup installer*; `apps/desktop`
(Electron) is the product it installs. They are separate builds and are easily
confused in bug reports.

- On macOS a bare launch of the installer **relaunches an existing install
  instead of showing setup** — that is deliberate, so the Applications icon acts
  as a launcher. Use `--reinstall` or `--repair` to force the setup UI.
- To test a genuine first run, set `HERMES_HOME` to a scratch directory. Do not
  delete `~/.hermes`: it holds `.env` and `auth.json` with live credentials.
- Do not edit renderer sources while an install is running. Stage titles arrive
  as a one-time event held in renderer memory, so a hot reload wipes them and
  the screen sticks at "0 of 0 steps" with the run still succeeding underneath.

## Private AI model policy

Models come from a **signed catalogue** that has passed legal benchmark review.
Two rules follow, and neither is a formality:

- A technically capable model that is not in the catalogue must never be
  offered. The product tells users their models are legally reviewed.
- Identity is the **digest**, not the tag. Tags are mutable, so `x:latest` and
  `x:8b` may be the same blob today and different tomorrow.

Context window and tool capability are **independent** gates. A model can
advertise a large context and support no tools, or support tools with too small
a window. Checking one and inferring the other ships an install that provisions
cleanly and then fails on the first message.
