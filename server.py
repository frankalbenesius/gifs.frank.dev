"""First-party API and private media server for gif urself."""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import re
import secrets
import smtplib
import ssl
import sqlite3
import sys
import time
import uuid
from email.message import EmailMessage
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, make_response, redirect, request, send_file, send_from_directory, session, url_for
from authlib.integrations.flask_client import OAuth
from PIL import Image, UnidentifiedImageError
from werkzeug.middleware.proxy_fix import ProxyFix

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "gifs.sqlite3"
MEDIA_DIR = DATA_DIR / "media"
BACKUP_DIR = DATA_DIR / "backups"
DIST_DIR = ROOT / "dist"
APP_ENV = os.environ.get("APP_ENV", "development")
FRONTEND_ORIGIN = os.environ.get(
    "FRONTEND_ORIGIN", "http://127.0.0.1:5173" if APP_ENV != "production" else ""
).rstrip("/")
MAIL_MODE = os.environ.get("MAIL_MODE", "smtp")
SECRET = os.environ.get("APP_SECRET", "")
OIDC_ISSUER = os.environ.get("OIDC_ISSUER", "").rstrip("/")
OIDC_CLIENT_ID = os.environ.get("OIDC_CLIENT_ID", "")
OIDC_CLIENT_SECRET = os.environ.get("OIDC_CLIENT_SECRET", "")
OIDC_READY = bool(OIDC_ISSUER and OIDC_CLIENT_ID and OIDC_CLIENT_SECRET)
MAX_GIF_BYTES = 8 * 1024 * 1024
SESSION_SECONDS = 30 * 24 * 60 * 60
CODE_SECONDS = 10 * 60
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

if APP_ENV == "production" and len(SECRET) < 32:
    raise RuntimeError("APP_SECRET must be at least 32 characters in production")
if not SECRET:
    SECRET = secrets.token_urlsafe(32)

app = Flask(__name__, static_folder=None)
app.secret_key = SECRET
app.config.update(
    SESSION_COOKIE_SECURE=APP_ENV == "production",
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config["MAX_CONTENT_LENGTH"] = MAX_GIF_BYTES + 4096
oauth = OAuth(app)
if OIDC_READY:
    oauth.register(
        name="frank",
        client_id=OIDC_CLIENT_ID,
        client_secret=OIDC_CLIENT_SECRET,
        server_metadata_url=f"{OIDC_ISSUER}/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email", "code_challenge_method": "S256"},
    )


def now() -> int:
    return int(time.time())


def new_id() -> str:
    return uuid.uuid4().hex


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(DB_PATH, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA journal_mode = WAL")
        g.db = db
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def migrate() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    try:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        files = sorted((ROOT / "migrations").glob("[0-9][0-9][0-9]_*.sql"))
        if files and version < int(files[-1].name[:3]) and DB_PATH.stat().st_size > 0 and version > 0:
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            backup_path = BACKUP_DIR / f"pre-migration-v{version}-{now()}.sqlite3"
            target = sqlite3.connect(backup_path)
            try:
                db.backup(target)
            finally:
                target.close()
        for path in files:
            number = int(path.name[:3])
            if number <= version:
                continue
            if number != version + 1:
                raise RuntimeError(f"Missing migration {version + 1:03d}")
            db.executescript(path.read_text())
            actual = db.execute("PRAGMA user_version").fetchone()[0]
            if actual != number:
                raise RuntimeError(f"Migration {path.name} did not set user_version={number}")
            version = number
    finally:
        db.close()


def error(message: str, status: int = 400):
    return jsonify(error=message), status


def json_body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def cookie_options() -> dict:
    return {
        "secure": APP_ENV == "production",
        "samesite": "Lax",
        "path": "/",
    }


@app.after_request
def set_csrf_cookie(response):
    if not request.cookies.get("gif_csrf"):
        token = g.get("new_csrf") or secrets.token_urlsafe(24)
        response.set_cookie("gif_csrf", token, httponly=False, max_age=SESSION_SECONDS, **cookie_options())
    return response


@app.before_request
def require_csrf():
    if not request.path.startswith("/api/") or request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    token = request.cookies.get("gif_csrf", "")
    submitted = request.headers.get("X-CSRF-Token", "")
    if not token or not submitted or not hmac.compare_digest(token, submitted):
        return error("Please reload and try again.", 403)
    return None


@app.errorhandler(413)
def too_large(_):
    return error("GIF is too large (8 MB maximum).", 413)


def current_user():
    token = request.cookies.get("gif_session", "")
    if not token:
        return None
    db = get_db()
    return db.execute(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
        "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
        (hashlib.sha256(token.encode()).hexdigest(), now()),
    ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return error("Sign in to continue.", 401)
        return view(user, *args, **kwargs)

    return wrapped


def normalize_email(value: object) -> str:
    email = str(value or "").strip().casefold()
    return email if len(email) <= 254 and EMAIL_RE.fullmatch(email) else ""


def code_hash(email: str, code: str) -> str:
    return hmac.new(SECRET.encode(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def ip_hash() -> str:
    # Caddy supplies the direct peer address; this is only a coarse rate-limit key.
    address = request.remote_addr or "unknown"
    return hmac.new(SECRET.encode(), address.encode(), hashlib.sha256).hexdigest()


def email_configured() -> bool:
    if MAIL_MODE == "file" and APP_ENV != "production":
        return True
    return all(
        os.environ.get(key)
        for key in ("SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD")
    )


def send_code(email: str, code: str) -> None:
    if MAIL_MODE == "file" and APP_ENV != "production":
        outbox = Path(os.environ.get("MAIL_OUTBOX", DATA_DIR / "mail-outbox.jsonl"))
        outbox.parent.mkdir(parents=True, exist_ok=True)
        with outbox.open("a") as stream:
            stream.write(json.dumps({"email": email, "code": code, "at": now()}) + "\n")
        return
    host = os.environ.get("SMTP_HOST", "")
    sender = os.environ.get("SMTP_FROM", "")
    if not email_configured():
        raise RuntimeError("Email delivery is not configured")
    message = EmailMessage()
    message["From"] = sender
    message["To"] = email
    message["Subject"] = "Your gif urself sign-in code"
    message.set_content(f"Your sign-in code is {code}. It expires in 10 minutes.\n")
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=12) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        username = os.environ.get("SMTP_USER", "")
        password = os.environ.get("SMTP_PASSWORD", "")
        smtp.login(username, password)
        smtp.send_message(message)


@app.get("/api/health")
def health():
    try:
        get_db().execute("SELECT 1 FROM users LIMIT 1").fetchone()
    except sqlite3.Error:
        return error("Database unavailable.", 503)
    return jsonify(status="ok")


@app.get("/api/session")
def session_info():
    user = current_user()
    csrf = request.cookies.get("gif_csrf")
    if not csrf:
        csrf = secrets.token_urlsafe(24)
        g.new_csrf = csrf
    return jsonify(
        user=(
            {"id": user["id"], "email": user["email"]}
            if user
            else None
        ),
        csrf=csrf,
        signInConfigured=OIDC_READY,
    )


def safe_destination(value: str | None) -> str:
    return value if value and value.startswith("/") and not value.startswith(("//", "/\\")) else "/gifs"


def client_destination(path: str) -> str:
    return f"{FRONTEND_ORIGIN}{path}" if FRONTEND_ORIGIN else path


@app.get("/api/auth/login")
def oidc_login():
    if not OIDC_READY:
        return error("Sign-in is not configured yet.", 503)
    session["return_to"] = safe_destination(request.args.get("next"))
    return oauth.frank.authorize_redirect(url_for("oidc_callback", _external=True))


@app.get("/api/auth/oidc/callback")
def oidc_callback():
    if not OIDC_READY:
        return error("Sign-in is not configured yet.", 503)
    try:
        token = oauth.frank.authorize_access_token()
        claims = token.get("userinfo") or {}
        identity = oauth.frank.userinfo(token=token)
        if identity.get("sub") != claims.get("sub"):
            return redirect(client_destination("/signin?error=identity"))
    except Exception:
        app.logger.exception("Shared sign-in failed")
        return redirect(client_destination("/signin?error=auth"))
    subject = identity.get("sub")
    email = normalize_email(identity.get("email"))
    if not subject or not email or identity.get("email_verified") is not True:
        return redirect(client_destination("/signin?error=identity"))
    db = get_db()
    with db:
        user = db.execute(
            "SELECT * FROM users WHERE identity_issuer = ? AND identity_subject = ?",
            (OIDC_ISSUER, subject),
        ).fetchone()
        if user is None:
            # A verified email proves control of an existing GIF account.
            user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if user and user["identity_subject"] is not None:
                return redirect(client_destination("/signin?error=account"))
            if user:
                db.execute(
                    "UPDATE users SET identity_issuer = ?, identity_subject = ? WHERE id = ?",
                    (OIDC_ISSUER, subject, user["id"]),
                )
            else:
                user_id = new_id()
                db.execute(
                    "INSERT INTO users(id, email, created_at, identity_issuer, identity_subject) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (user_id, email, now(), OIDC_ISSUER, subject),
                )
                user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        elif user["email"] != email:
            db.execute("UPDATE users SET email = ? WHERE id = ?", (email, user["id"]))
        session_token = secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (hashlib.sha256(session_token.encode()).hexdigest(), user["id"], now() + SESSION_SECONDS),
        )
    destination = session.pop("return_to", "/gifs")
    response = redirect(client_destination(destination))
    response.set_cookie("gif_session", session_token, httponly=True, max_age=SESSION_SECONDS, **cookie_options())
    return response


@app.post("/api/auth/request-code")
def request_code():
    if OIDC_READY:
        return error("Use shared sign-in.", 410)
    body = json_body()
    email = normalize_email(body.get("email"))
    if not email:
        return error("Enter a valid email address.")
    if not email_configured():
        return error("Email sign-in is not configured yet.", 503)
    db = get_db()
    moment = now()
    key = ip_hash()
    with db:
        db.execute("DELETE FROM auth_requests WHERE requested_at < ?", (moment - 3600,))
        count = db.execute(
            "SELECT COUNT(*) FROM auth_requests WHERE ip_hash = ? AND requested_at > ?",
            (key, moment - 3600),
        ).fetchone()[0]
        if count >= 20:
            return error("Too many codes requested. Try again later.", 429)
        existing = db.execute("SELECT requested_at FROM email_codes WHERE email = ?", (email,)).fetchone()
        if existing and moment - existing["requested_at"] < 60:
            return error("Wait a minute before requesting another code.", 429)
        db.execute("INSERT INTO auth_requests(ip_hash, requested_at) VALUES (?, ?)", (key, moment))
    code = f"{secrets.randbelow(1_000_000):06d}"
    try:
        send_code(email, code)
    except (OSError, smtplib.SMTPException, RuntimeError):
        app.logger.exception("Could not deliver sign-in code")
        return error("Could not send a code right now. Try again later.", 503)
    with db:
        db.execute(
            "INSERT INTO email_codes(email, code_hash, expires_at, requested_at, attempts) "
            "VALUES (?, ?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET "
            "code_hash=excluded.code_hash, expires_at=excluded.expires_at, "
            "requested_at=excluded.requested_at, attempts=0",
            (email, code_hash(email, code), moment + CODE_SECONDS, moment),
        )
    return jsonify(sent=True)


@app.post("/api/auth/verify")
def verify_code():
    if OIDC_READY:
        return error("Use shared sign-in.", 410)
    body = json_body()
    email = normalize_email(body.get("email"))
    code = str(body.get("code", ""))
    if not email or not re.fullmatch(r"[0-9]{6}", code):
        return error("Enter the six-digit code.")
    db = get_db()
    row = db.execute("SELECT * FROM email_codes WHERE email = ?", (email,)).fetchone()
    if not row or row["expires_at"] <= now() or row["attempts"] >= 5:
        return error("Code expired or unavailable. Request a new one.", 400)
    if not hmac.compare_digest(row["code_hash"], code_hash(email, code)):
        with db:
            db.execute("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?", (email,))
        return error("That code didn't match.", 400)
    token = secrets.token_urlsafe(32)
    with db:
        db.execute("DELETE FROM email_codes WHERE email = ?", (email,))
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            user_id = new_id()
            db.execute(
                "INSERT INTO users(id, email, created_at) VALUES (?, ?, ?)",
                (user_id, email, now()),
            )
            user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        db.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), user["id"], now() + SESSION_SECONDS),
        )
    response = make_response(jsonify(user={"id": user["id"], "email": user["email"]}))
    response.set_cookie(
        "gif_session", token, httponly=True, max_age=SESSION_SECONDS, **cookie_options()
    )
    return response


@app.post("/api/auth/signout")
@login_required
def signout(user):
    token = request.cookies.get("gif_session", "")
    with get_db():
        get_db().execute(
            "DELETE FROM sessions WHERE token_hash = ? AND user_id = ?",
            (hashlib.sha256(token.encode()).hexdigest(), user["id"]),
        )
    response = make_response(jsonify(signedOut=True))
    response.delete_cookie("gif_session", path="/")
    return response


def gif_access(user_id: str, gif_id: str):
    return get_db().execute(
        "SELECT * FROM gifs WHERE id = ? AND owner_id = ?",
        (gif_id, user_id),
    ).fetchone()


def gif_payload(row) -> dict:
    return {
        "id": row["id"],
        "createdAt": row["created_at"],
        "sizeBytes": row["size_bytes"],
        "fileUrl": f"/api/gifs/{row['id']}/file",
        "posterUrl": f"/api/gifs/{row['id']}/poster",
    }


def gif_list(user_id: str):
    rows = get_db().execute(
        "SELECT * FROM gifs WHERE owner_id = ? ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()
    return [gif_payload(row) for row in rows]


@app.get("/api/gifs")
@login_required
def own_gifs(user):
    return jsonify(gifs=gif_list(user["id"]))


@app.get("/api/gifs/<gif_id>")
@login_required
def get_gif(user, gif_id):
    row = gif_access(user["id"], gif_id)
    return jsonify(gif=gif_payload(row)) if row else error("GIF unavailable.", 404)


def media_response(user, gif_id, extension: str, mime: str, download=False):
    if not gif_access(user["id"], gif_id):
        return error("GIF unavailable.", 404)
    path = MEDIA_DIR / f"{gif_id}.{extension}"
    if not path.is_file():
        return error("GIF unavailable.", 404)
    response = send_file(
        path,
        mimetype=mime,
        as_attachment=download,
        download_name=f"gif-urself-{gif_id}.gif" if download else None,
        conditional=False,
    )
    response.headers["Cache-Control"] = "private, no-store"
    return response


@app.get("/api/gifs/<gif_id>/file")
@login_required
def gif_file(user, gif_id):
    return media_response(user, gif_id, "gif", "image/gif", request.args.get("download") == "1")


@app.get("/api/gifs/<gif_id>/poster")
@login_required
def gif_poster(user, gif_id):
    return media_response(user, gif_id, "png", "image/png")


@app.post("/api/gifs")
@login_required
def create_gif(user):
    upload = request.files.get("file")
    upload_key = request.form.get("uploadKey", "")
    if not upload or not re.fullmatch(r"[a-zA-Z0-9-]{8,80}", upload_key):
        return error("GIF upload is incomplete.")
    if request.form.get("groupIds") not in (None, "[]"):
        return error("Group sharing is no longer available.")
    db = get_db()
    existing = db.execute(
        "SELECT * FROM gifs WHERE owner_id = ? AND upload_key = ?",
        (user["id"], upload_key),
    ).fetchone()
    if existing:
        return jsonify(gif=gif_payload(existing))
    contents = upload.read(MAX_GIF_BYTES + 1)
    if len(contents) > MAX_GIF_BYTES:
        return error("GIF is too large (8 MB maximum).", 413)
    try:
        image = Image.open(io.BytesIO(contents))
        if image.format != "GIF":
            return error("Only GIF files can be saved.")
        width, height = image.size
        if width < 1 or height < 1 or width > 1200 or height > 1200 or abs(width / height - 4 / 3) > 0.02:
            return error("GIF must be 4:3 and at most 1200 pixels wide or tall.")
        if getattr(image, "n_frames", 1) > 90:
            return error("GIF has too many frames.")
        image.seek(0)
        poster = image.convert("RGB")
        poster.thumbnail((320, 240))
        poster_bytes = io.BytesIO()
        poster.save(poster_bytes, format="PNG", optimize=True)
    except (UnidentifiedImageError, OSError, ValueError):
        return error("Could not read that GIF.")
    gif_id = new_id()
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    gif_path = MEDIA_DIR / f"{gif_id}.gif"
    poster_path = MEDIA_DIR / f"{gif_id}.png"
    try:
        gif_path.write_bytes(contents)
        poster_path.write_bytes(poster_bytes.getvalue())
        with db:
            db.execute(
                "INSERT INTO gifs(id, owner_id, upload_key, size_bytes, width, height, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (gif_id, user["id"], upload_key, len(contents), width, height, now()),
            )
    except Exception:
        gif_path.unlink(missing_ok=True)
        poster_path.unlink(missing_ok=True)
        raise
    row = db.execute("SELECT * FROM gifs WHERE id = ?", (gif_id,)).fetchone()
    return jsonify(gif=gif_payload(row)), 201


@app.delete("/api/gifs/<gif_id>")
@login_required
def delete_gif(user, gif_id):
    db = get_db()
    row = db.execute(
        "SELECT id FROM gifs WHERE id = ? AND owner_id = ?", (gif_id, user["id"])
    ).fetchone()
    if not row:
        return error("GIF unavailable.", 404)
    with db:
        db.execute("DELETE FROM gifs WHERE id = ?", (gif_id,))
    for extension in ("gif", "png"):
        (MEDIA_DIR / f"{gif_id}.{extension}").unlink(missing_ok=True)
    return jsonify(deleted=True)


@app.delete("/api/me")
@login_required
def delete_me(user):
    db = get_db()
    gif_ids = [
        row["id"]
        for row in db.execute("SELECT id FROM gifs WHERE owner_id = ?", (user["id"],)).fetchall()
    ]
    with db:
        db.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    for gif_id in gif_ids:
        for extension in ("gif", "png"):
            (MEDIA_DIR / f"{gif_id}.{extension}").unlink(missing_ok=True)
    response = make_response(jsonify(deleted=True))
    response.delete_cookie("gif_session", path="/")
    return response


@app.get("/")
@app.get("/<path:path>")
def client(path=""):
    if path and (DIST_DIR / path).is_file():
        return send_from_directory(DIST_DIR, path)
    if path.startswith("api/") or "." in Path(path).name:
        return error("Not found.", 404)
    return send_from_directory(DIST_DIR, "index.html")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "migrate":
        migrate()
    elif len(sys.argv) > 1 and sys.argv[1] == "serve":
        migrate()
        app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
    else:
        print("Usage: python server.py migrate|serve", file=sys.stderr)
        raise SystemExit(2)
