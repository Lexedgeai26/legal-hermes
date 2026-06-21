"""Gmail OAuth helpers for the Email messaging adapter.

The flow uses Google's installed-app OAuth + PKCE loopback redirect and stores
tokens locally under ``~/.hermes/auth/gmail_oauth.json``.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import http.server
import json
import logging
import os
import secrets
import stat
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from hermes_constants import get_hermes_home, secure_parent_dir
from utils import atomic_replace

logger = logging.getLogger(__name__)

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v1/userinfo"

GMAIL_SCOPES = (
    "https://mail.google.com/ "
    "https://www.googleapis.com/auth/userinfo.email "
    "https://www.googleapis.com/auth/userinfo.profile"
)

REDIRECT_HOST = "127.0.0.1"
DEFAULT_REDIRECT_PORT = 8095
CALLBACK_PATH = "/gmail-oauth/callback"
TOKEN_TIMEOUT_SECONDS = 20
CALLBACK_WAIT_SECONDS = 300
REFRESH_SKEW_SECONDS = 60


class GmailOAuthError(RuntimeError):
    pass


@dataclass
class GmailCredentials:
    access_token: str
    refresh_token: str
    expires_at_ms: int
    email: str = ""


def credentials_path() -> Path:
    override = os.getenv("GMAIL_OAUTH_TOKEN_FILE", "").strip()
    if override:
      return Path(override).expanduser()
    return get_hermes_home() / "auth" / "gmail_oauth.json"


def _client_from_env() -> tuple[str, str]:
    client_id = os.getenv("GMAIL_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GMAIL_OAUTH_CLIENT_SECRET", "").strip()
    client_file = os.getenv("GMAIL_OAUTH_CLIENT_SECRET_FILE", "").strip()

    if client_file:
        try:
            raw = json.loads(Path(client_file).expanduser().read_text(encoding="utf-8"))
            block = raw.get("installed") or raw.get("web") or {}
            client_id = client_id or str(block.get("client_id") or "")
            client_secret = client_secret or str(block.get("client_secret") or "")
        except Exception as exc:
            logger.warning("Could not read Gmail OAuth client file %s: %s", client_file, exc)

    if not client_id:
        raise GmailOAuthError("GMAIL_OAUTH_CLIENT_ID is required.")
    return client_id, client_secret


def _save_credentials(creds: GmailCredentials) -> None:
    path = credentials_path()
    secure_parent_dir(path.parent)
    payload = {
        "access": creds.access_token,
        "refresh": creds.refresh_token,
        "expires": creds.expires_at_ms,
        "email": creds.email,
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    atomic_replace(tmp, path)


def load_credentials() -> Optional[GmailCredentials]:
    path = credentials_path()
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return GmailCredentials(
            access_token=str(raw.get("access") or ""),
            refresh_token=str(raw.get("refresh") or ""),
            expires_at_ms=int(raw.get("expires") or 0),
            email=str(raw.get("email") or ""),
        )
    except Exception as exc:
        logger.warning("Could not read Gmail OAuth credentials: %s", exc)
        return None


def _generate_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _post_form(data: dict[str, str]) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(data).encode("utf-8")
    request = urllib.request.Request(
        TOKEN_ENDPOINT,
        data=encoded,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TOKEN_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def _fetch_email(access_token: str) -> str:
    try:
        request = urllib.request.Request(
            USERINFO_ENDPOINT + "?alt=json",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        with urllib.request.urlopen(request, timeout=TOKEN_TIMEOUT_SECONDS) as response:
            raw = json.loads(response.read().decode("utf-8", errors="replace"))
        return str(raw.get("email") or "")
    except Exception:
        return ""


class _OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
    expected_state = ""
    captured_code: Optional[str] = None
    captured_error: Optional[str] = None
    ready: Optional[threading.Event] = None

    def log_message(self, format: str, *args: Any) -> None:
        logger.debug("Gmail OAuth callback: " + format, *args)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        state = (params.get("state") or [""])[0]
        if parsed.path != CALLBACK_PATH or state != self.expected_state:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Invalid Gmail OAuth callback.")
            return
        type(self).captured_error = (params.get("error") or [""])[0] or None
        type(self).captured_code = (params.get("code") or [""])[0] or None
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Gmail connected. You can return to LexEdge AI.")
        if type(self).ready:
            type(self).ready.set()


def _bind_callback_server() -> tuple[http.server.HTTPServer, int]:
    for port in (DEFAULT_REDIRECT_PORT, 0):
        try:
            server = http.server.HTTPServer((REDIRECT_HOST, port), _OAuthCallbackHandler)
            return server, int(server.server_address[1])
        except OSError:
            continue
    raise GmailOAuthError("Could not bind local Gmail OAuth callback server.")


def start_oauth_flow(*, open_browser: bool = True) -> GmailCredentials:
    client_id, client_secret = _client_from_env()
    verifier, challenge = _generate_pkce_pair()
    state = secrets.token_urlsafe(16)
    server, port = _bind_callback_server()
    redirect_uri = f"http://{REDIRECT_HOST}:{port}{CALLBACK_PATH}"

    _OAuthCallbackHandler.expected_state = state
    _OAuthCallbackHandler.captured_code = None
    _OAuthCallbackHandler.captured_error = None
    ready = threading.Event()
    _OAuthCallbackHandler.ready = ready

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": GMAIL_SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        "prompt": "consent",
    }
    auth_url = AUTH_ENDPOINT + "?" + urllib.parse.urlencode(params)

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        if open_browser:
            import webbrowser

            webbrowser.open(auth_url, new=1, autoraise=True)
        if not ready.wait(timeout=CALLBACK_WAIT_SECONDS):
            raise GmailOAuthError("Timed out waiting for Gmail authorization.")
        if _OAuthCallbackHandler.captured_error:
            raise GmailOAuthError(f"Gmail authorization failed: {_OAuthCallbackHandler.captured_error}")
        code = _OAuthCallbackHandler.captured_code
        if not code:
            raise GmailOAuthError("No Gmail authorization code received.")
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
        }
        if client_secret:
            data["client_secret"] = client_secret
        token = _post_form(data)
        access = str(token.get("access_token") or "")
        refresh = str(token.get("refresh_token") or "")
        if not access or not refresh:
            raise GmailOAuthError("Gmail OAuth response did not include access and refresh tokens.")
        expires_in = int(token.get("expires_in") or 3600)
        creds = GmailCredentials(
            access_token=access,
            refresh_token=refresh,
            expires_at_ms=int((time.time() + expires_in) * 1000),
            email=_fetch_email(access),
        )
        _save_credentials(creds)
        return creds
    finally:
        with contextlib.suppress(Exception):
            server.shutdown()
        with contextlib.suppress(Exception):
            server.server_close()
        thread.join(timeout=2)


def get_valid_access_token() -> str:
    creds = load_credentials()
    if not creds or not creds.refresh_token:
        raise GmailOAuthError("Gmail is not connected. Connect Gmail from Messaging settings.")
    if creds.access_token and time.time() < (creds.expires_at_ms / 1000) - REFRESH_SKEW_SECONDS:
        return creds.access_token
    client_id, client_secret = _client_from_env()
    data = {
        "grant_type": "refresh_token",
        "refresh_token": creds.refresh_token,
        "client_id": client_id,
    }
    if client_secret:
        data["client_secret"] = client_secret
    token = _post_form(data)
    access = str(token.get("access_token") or "")
    if not access:
        raise GmailOAuthError("Gmail token refresh returned no access token.")
    expires_in = int(token.get("expires_in") or 3600)
    refreshed = GmailCredentials(
        access_token=access,
        refresh_token=creds.refresh_token,
        expires_at_ms=int((time.time() + expires_in) * 1000),
        email=creds.email,
    )
    _save_credentials(refreshed)
    return access
