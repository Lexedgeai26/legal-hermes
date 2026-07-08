# Hermes - Legal Agent by LexEdge AI Windows installer runbook

## Goal

Ship a Windows installer that feels safe for non-technical legal users:

- installs Hermes - Legal Agent as a normal Start Menu/Desktop app
- provisions user-scoped dependencies without admin rights where possible
- shows clear progress while large dependencies download
- retries transient network failures automatically
- leaves a support transcript when setup fails

## Recommended release path

Use a signed NSIS `.exe` as the primary Windows installer.

The app already has a staged Hermes bootstrap protocol. The installer should install the Electron app, launch it at the end, and let the in-app setup overlay run dependency stages with visible progress.

Why this path:

- NSIS gives users a familiar Windows installer.
- The Electron app already streams stage-by-stage setup progress from `install.ps1`.
- We avoid duplicating dependency logic in NSIS.
- The same repair flow works after install if a dependency is missing or corrupted.

## Current build commands

Cross-build ZIP on macOS:

```bash
cd <repo-root>/apps/desktop
npm run dist:win:zip
```

Build professional Windows installers on a Windows build machine or Windows CI:

```powershell
cd apps\desktop
npm run dist:win:nsis
npm run dist:win:msi
```

The macOS machine can prepare the source and ZIP artifact, but reliable `.exe` / `.msi` creation needs Windows CI or a Windows builder because NSIS/MSI packaging depends on Windows tooling.

## User experience

1. User downloads `LexEdge-AI-<version>-win-x64.exe`.
2. Installer creates Start Menu and Desktop shortcuts.
3. Installer launches Hermes - Legal Agent.
4. Hermes - Legal Agent shows "Setting up LexEdge Legal Hermes Agent".
5. The setup overlay shows completed steps, current stage, elapsed time, recent output, and retry/download messages.
6. If setup fails, the user sees a clear error, can copy installer output, and can reload/retry without deleting chats or settings.

## Dependency strategy

The installer/bootstrap uses user-scoped dependencies:

- `uv` for Python provisioning
- Python 3.11 runtime through `uv`
- portable Git when system Git is unavailable
- portable Node.js when system Node is unavailable
- Python dependencies
- Node dependencies
- messaging/browser helper SDKs

Downloads use retry logic and timeout handling in `scripts/install.ps1`.

## Network handling

Slow or unstable networks are expected. Setup should:

- show which host is being downloaded from
- show attempt number and timeout
- retry before failing
- remove partial downloads before retrying
- surface proxy/TLS guidance when npm reports certificate errors
- preserve logs in `%LOCALAPPDATA%\hermes\logs`

## Support guidance

When a user reports setup failure, ask for:

- screenshot of the setup screen
- copied installer output from the failure screen
- `%LOCALAPPDATA%\hermes\logs\desktop.log`
- latest `%LOCALAPPDATA%\hermes\logs\bootstrap-*.log`

## Next hardening steps

1. Add code signing for the Windows `.exe`.
2. Build NSIS/MSI on Windows CI rather than macOS.
3. Add an optional offline installer bundle for locked-down legal/corporate networks.
4. Add a "Send diagnostics" button once support upload infrastructure exists.
