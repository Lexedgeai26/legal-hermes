# Refreshing offline installer assets

This directory holds the raw, pinned binaries that `build-offline-bundle.cjs`
packages into the offline installer. It's gitignored (like `apps/desktop/build/`
generally) because these are large (~190MB) and change rarely.

Regenerate when a pinned version changes in `scripts/install.ps1`
(`$PythonVersion`, PortableGit's tag, `$NodeVersion`) or `pyproject.toml`'s
`requires-python` / `uv.lock`.

## uv

```
curl -sSL -o uv/uv.zip "https://github.com/astral-sh/uv/releases/download/<VERSION>/uv-x86_64-pc-windows-msvc.zip"
```

## Python (must match install.ps1's $PythonVersion)

Easiest: let a local `uv` resolve the exact python-build-standalone build it
would fetch on a real machine, then grab that same URL directly (don't hand-guess
the release tag/date -- it changes independently of the Python patch version):

```
uv python install 3.11 --verbose   # note the "Downloading https://releases.astral.sh/..." URL in the output
curl -sSL -o python/cpython-<version>-x86_64-pc-windows-msvc-install_only_stripped.tar.gz "<that URL>"
```

## Git (PortableGit, matches install.ps1's Install-Git pin)

```
curl -sSL -o git/PortableGit.7z.exe "https://github.com/git-for-windows/git/releases/download/v<TAG>/PortableGit-<VERSION>-64-bit.7z.exe"
```

## Node (matches install.ps1's $NodeVersion major)

```
curl -sSL "https://nodejs.org/dist/latest-v22.x/" -o /tmp/nodeindex.html
grep -oE 'node-v22\.[0-9]+\.[0-9]+-win-x64\.zip' /tmp/nodeindex.html | head -1
curl -sSL -o node/node.zip "https://nodejs.org/dist/latest-v22.x/<resolved-zip-name>"
```

## ripgrep

```
curl -sSL -o ripgrep/rg.zip "https://github.com/BurntSushi/ripgrep/releases/download/<VERSION>/ripgrep-<VERSION>-x86_64-pc-windows-msvc.zip"
```

## Wheelhouse (win_amd64/cp311 wheels for `hermes-agent[all]`, from uv.lock)

Run from the repo root, on a Windows machine with a working `uv` and a
Python 3.11 interpreter available for `pip`:

```
uv export --extra all --locked --format requirements.txt --no-hashes -o /tmp/offline-requirements.txt
grep -v "^-e \.$" /tmp/offline-requirements.txt | grep -v "^\s*#" | grep -v "^\s*$" > /tmp/offline-requirements-clean.txt

<python3.11> -m pip download \
  -r /tmp/offline-requirements-clean.txt \
  -d wheelhouse \
  --only-binary :all: \
  --python-version 311 \
  --implementation cp \
  --platform win_amd64 \
  --no-deps

# Build-system deps for the local editable `hermes-agent` install itself --
# not in uv.lock's runtime deps, needed separately:
<python3.11> -m pip download "setuptools>=77.0,<83" "wheel" \
  -d wheelhouse --only-binary :all: --python-version 311 --implementation cp --platform win_amd64
```

If any package has no win_amd64/cp311 wheel on PyPI, `pip download` fails
loudly for that package -- resolve it (pin a different version, or drop it
from `[all]` in `pyproject.toml` if it's not actually load-bearing on
Windows) before shipping. Don't silently skip a failed download; a missing
wheel means `uv sync --offline` will fail at install time on a machine with
no internet to fall back on.

## After refreshing

Update `VERSIONS` at the top of `../../scripts/build-offline-bundle.cjs` to
match, then run `npm run build:offline-bundle` (or let `dist:win:offline` do
it) to regenerate `build/offline-bundle/manifest.json` with fresh checksums.
