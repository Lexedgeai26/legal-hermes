#!/usr/bin/env python3
"""Generate a production signing key and sign a model catalogue.

Release builds pin no trusted key, so no catalogue can load and Private AI is
unavailable — the fail-closed default described in catalogue.rs. This tool
performs the one-time setup that closes that gap.

The dev key is derived from DEV_SIGNING_SEED, a hardcoded constant in a public
repository, so it is forgeable by anyone and is trusted only in debug builds.
A production key must be generated here and kept out of the repository.

Usage
-----
  keygen        Create a production keypair. Private key is written once, 0600.
                  python3 catalogue-sign.py keygen --out ~/.lexedge-signing

  sign          Sign a catalogue JSON into a signed envelope.
                  python3 catalogue-sign.py sign \
                      --key ~/.lexedge-signing/catalogue-signing.key \
                      --key-id lexedge-prod-2026 \
                      --catalogue catalogue.json \
                      --out catalogue.signed.json

  verify        Check an envelope against a public key, exactly as the
                installer does, before shipping it.
                  python3 catalogue-sign.py verify \
                      --pub ~/.lexedge-signing/catalogue-signing.pub \
                      --envelope catalogue.signed.json

Requires:  pip install cryptography
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )
except ImportError:
    sys.exit("cryptography is required:  pip install cryptography")

# Must match signed_envelope.rs / catalogue.rs.
ENVELOPE_SCHEMA_VERSION = 1
ALGORITHM = "Ed25519"
MAX_SIGNED_PAYLOAD_BYTES = 1_048_576


def keygen(args: argparse.Namespace) -> None:
    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o700)

    priv_path = out / "catalogue-signing.key"
    pub_path = out / "catalogue-signing.pub"

    # Never silently replace a signing key: catalogues already signed with the
    # old one would stop verifying, and the only recovery is a new installer.
    if priv_path.exists():
        sys.exit(f"Refusing to overwrite an existing key at {priv_path}")

    private = Ed25519PrivateKey.generate()
    seed = private.private_bytes_raw()
    public = private.public_key().public_bytes_raw()

    priv_path.write_bytes(seed)
    os.chmod(priv_path, 0o600)
    pub_path.write_text(base64.b64encode(public).decode() + "\n")
    os.chmod(pub_path, 0o644)

    print(f"private key : {priv_path}   (0600 — never commit, never share)")
    print(f"public key  : {pub_path}")
    print()
    print("Pin this in trusted_keys() in src/catalogue.rs — the public key is")
    print("safe to commit; it can only verify, never sign:")
    print()
    print("    entries.push((")
    print('        "lexedge-prod-2026".to_string(),')
    print(f"        {list(public)!r},")
    print("    ));")
    print()
    print("Back the private key up somewhere durable. Losing it means every")
    print("future catalogue needs a new key and a new installer release.")


def _load_private(path: Path) -> Ed25519PrivateKey:
    raw = Path(path).expanduser().read_bytes()
    if len(raw) != 32:
        sys.exit(f"{path} is not a 32-byte Ed25519 seed")
    return Ed25519PrivateKey.from_private_bytes(raw)


def sign(args: argparse.Namespace) -> None:
    catalogue_path = Path(args.catalogue).expanduser()
    catalogue = json.loads(catalogue_path.read_text())

    # Sign the exact bytes the installer will verify and then parse. Re-encoding
    # canonically here means the signature covers precisely what is shipped,
    # with no room for a whitespace-only difference to break verification.
    payload = json.dumps(catalogue, separators=(",", ":"), sort_keys=True).encode()
    if not payload or len(payload) > MAX_SIGNED_PAYLOAD_BYTES:
        sys.exit(f"Payload size {len(payload)} is outside the accepted range")

    private = _load_private(args.key)
    signature = private.sign(payload)

    envelope = {
        "schema_version": ENVELOPE_SCHEMA_VERSION,
        "key_id": args.key_id,
        "algorithm": ALGORITHM,
        "payload": base64.b64encode(payload).decode(),
        "signature": base64.b64encode(signature).decode(),
    }
    out = Path(args.out).expanduser()
    out.write_text(json.dumps(envelope, indent=2) + "\n")

    print(f"signed      : {out}")
    print(f"key_id      : {args.key_id}")
    print(f"payload     : {len(payload)} bytes")
    if "not_after" in catalogue:
        print(f"expires     : {catalogue['not_after']}")
    else:
        print("WARNING: catalogue has no not_after — it will never expire.")


def verify(args: argparse.Namespace) -> None:
    envelope = json.loads(Path(args.envelope).expanduser().read_text())
    pub_raw = base64.b64decode(Path(args.pub).expanduser().read_text().strip())
    public = Ed25519PublicKey.from_public_bytes(pub_raw)

    if envelope.get("schema_version") != ENVELOPE_SCHEMA_VERSION:
        sys.exit(f"Unsupported schema_version {envelope.get('schema_version')}")
    if envelope.get("algorithm") != ALGORITHM:
        sys.exit(f"Unsupported algorithm {envelope.get('algorithm')}")

    payload = base64.b64decode(envelope["payload"])
    try:
        public.verify(base64.b64decode(envelope["signature"]), payload)
    except Exception:
        sys.exit("SIGNATURE INVALID — do not ship this envelope")

    catalogue = json.loads(payload)
    print("signature   : VALID")
    print(f"key_id      : {envelope['key_id']}")
    print(f"catalogue   : {catalogue.get('id', '?')} v{catalogue.get('version', '?')}")
    print(f"expires     : {catalogue.get('not_after', 'never — this is a problem')}")
    profiles = catalogue.get("profiles") or catalogue.get("catalogue", {}).get("profiles", [])
    print(f"profiles    : {len(profiles)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("keygen", help="create a production signing keypair")
    p.add_argument("--out", default="~/.lexedge-signing")
    p.set_defaults(func=keygen)

    p = sub.add_parser("sign", help="sign a catalogue into an envelope")
    p.add_argument("--key", required=True)
    p.add_argument("--key-id", required=True)
    p.add_argument("--catalogue", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=sign)

    p = sub.add_parser("verify", help="verify an envelope as the installer would")
    p.add_argument("--pub", required=True)
    p.add_argument("--envelope", required=True)
    p.set_defaults(func=verify)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
