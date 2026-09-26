"""First-party API and private media server for gif urself."""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import smtplib
import sqlite3
import sys
import time
import uuid
from email.message import EmailMessage
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, make_response, request, send_file, send_from_directory
from PIL import Image, UnidentifiedImageError
from werkzeug.middleware.proxy_fix import ProxyFix

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "gifs.sqlite3"
MEDIA_DIR = DATA_DIR / "media"
BACKUP_DIR = DATA_DIR / "backups"
DIST_DIR = ROOT / "dist"
APP_ENV = os.environ.get("APP_ENV", "development")
MAIL_MODE = os.environ.get("MAIL_MODE", "smtp")
SECRET = os.environ.get("APP_SECRET", "")
MAX_GIF_BYTES = 8 * 1024 * 1024
SESSION_SECONDS = 30 * 24 * 60 * 60
INVITE_SECONDS = 30 * 24 * 60 * 60
CODE_SECONDS = 10 * 60
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

if APP_ENV == "production" and len(SECRET) < 32:
    raise RuntimeError("APP_SECRET must be at least 32 characters in production")
if not SECRET:
    SECRET = secrets.token_urlsafe(32)

app = Flask(__name__, static_folder=None)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config["MAX_CONTENT_LENGTH"] = MAX_GIF_BYTES + 4096


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


def send_code(email: str, code: str) -> None:
    if MAIL_MODE == "file" and APP_ENV != "production":
        outbox = Path(os.environ.get("MAIL_OUTBOX", DATA_DIR / "mail-outbox.jsonl"))
        outbox.parent.mkdir(parents=True, exist_ok=True)
        with outbox.open("a") as stream:
            stream.write(json.dumps({"email": email, "code": code, "at": now()}) + "\n")
        return
    host = os.environ.get("SMTP_HOST", "")
    sender = os.environ.get("SMTP_FROM", "")
    if not host or not sender:
        raise RuntimeError("Email delivery is not configured")
    message = EmailMessage()
    message["From"] = sender
    message["To"] = email
    message["Subject"] = "Your gif urself sign-in code"
    message.set_content(f"Your sign-in code is {code}. It expires in 10 minutes.\n")
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=12) as smtp:
        smtp.starttls()
        username = os.environ.get("SMTP_USER", "")
        password = os.environ.get("SMTP_PASSWORD", "")
        if username and password:
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
            {"id": user["id"], "email": user["email"], "displayName": user["display_name"]}
            if user
            else None
        ),
        csrf=csrf,
        emailConfigured=MAIL_MODE == "file" and APP_ENV != "production"
        or bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM")),
    )


@app.post("/api/auth/request-code")
def request_code():
    body = json_body()
    email = normalize_email(body.get("email"))
    if not email:
        return error("Enter a valid email address.")
    if MAIL_MODE != "file" and not (os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM")):
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
                "INSERT INTO users(id, email, display_name, created_at) VALUES (?, ?, NULL, ?)",
                (user_id, email, now()),
            )
            user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        db.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), user["id"], now() + SESSION_SECONDS),
        )
    response = make_response(jsonify(user={
        "id": user["id"], "email": user["email"], "displayName": user["display_name"]
    }))
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


def group_row(user_id: str, group_id: str):
    return get_db().execute(
        "SELECT groups.*, memberships.role FROM groups "
        "JOIN memberships ON memberships.group_id = groups.id "
        "WHERE groups.id = ? AND memberships.user_id = ?",
        (group_id, user_id),
    ).fetchone()


def group_payload(row) -> dict:
    count = get_db().execute(
        "SELECT COUNT(*) FROM memberships WHERE group_id = ?", (row["id"],)
    ).fetchone()[0]
    return {
        "id": row["id"],
        "name": row["name"],
        "role": row["role"],
        "memberCount": count,
    }


@app.get("/api/groups")
@login_required
def list_groups(user):
    rows = get_db().execute(
        "SELECT groups.*, memberships.role FROM groups "
        "JOIN memberships ON memberships.group_id = groups.id "
        "WHERE memberships.user_id = ? ORDER BY groups.created_at DESC",
        (user["id"],),
    ).fetchall()
    return jsonify(groups=[group_payload(row) for row in rows])


@app.post("/api/groups")
@login_required
def create_group(user):
    name = str(json_body().get("name", "")).strip()
    if not 1 <= len(name) <= 60:
        return error("Group name must be 1–60 characters.")
    group_id = new_id()
    db = get_db()
    with db:
        db.execute(
            "INSERT INTO groups(id, name, created_at) VALUES (?, ?, ?)",
            (group_id, name, now()),
        )
        db.execute(
            "INSERT INTO memberships(group_id, user_id, role, joined_at) "
            "VALUES (?, ?, 'manager', ?)",
            (group_id, user["id"], now()),
        )
        reset_invite(db, group_id)
    return jsonify(group=group_payload(group_row(user["id"], group_id))), 201


@app.get("/api/groups/<group_id>")
@login_required
def get_group(user, group_id):
    row = group_row(user["id"], group_id)
    return jsonify(group=group_payload(row)) if row else error("Group unavailable.", 404)


@app.get("/api/groups/<group_id>/members")
@login_required
def group_members(user, group_id):
    group = group_row(user["id"], group_id)
    if not group:
        return error("Group unavailable.", 404)
    rows = get_db().execute(
        "SELECT users.id, users.display_name, users.email, memberships.role "
        "FROM memberships JOIN users ON users.id = memberships.user_id "
        "WHERE memberships.group_id = ? ORDER BY memberships.joined_at",
        (group_id,),
    ).fetchall()
    return jsonify(members=[
        {
            "id": row["id"],
            "displayName": row["display_name"] or "Unnamed member",
            "role": row["role"],
            **({"email": row["email"]} if group["role"] == "manager" else {}),
        }
        for row in rows
    ])


def manager_group(user_id: str, group_id: str):
    group = group_row(user_id, group_id)
    return group if group and group["role"] == "manager" else None


def reset_invite(db: sqlite3.Connection, group_id: str) -> dict:
    token = secrets.token_urlsafe(24)
    expires_at = now() + INVITE_SECONDS
    db.execute(
        "INSERT INTO invites(group_id, token, expires_at) VALUES (?, ?, ?) "
        "ON CONFLICT(group_id) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at",
        (group_id, token, expires_at),
    )
    return {"token": token, "expiresAt": expires_at}


@app.get("/api/groups/<group_id>/invite")
@login_required
def get_invite(user, group_id):
    if not manager_group(user["id"], group_id):
        return error("Only managers can invite.", 403)
    db = get_db()
    row = db.execute(
        "SELECT token, expires_at FROM invites WHERE group_id = ?", (group_id,)
    ).fetchone()
    if not row or row["expires_at"] <= now():
        return jsonify(invite=None)
    return jsonify(invite={"token": row["token"], "expiresAt": row["expires_at"]})


@app.post("/api/groups/<group_id>/invite/reset")
@login_required
def renew_invite(user, group_id):
    if not manager_group(user["id"], group_id):
        return error("Only managers can reset invitations.", 403)
    db = get_db()
    with db:
        invite = reset_invite(db, group_id)
    return jsonify(invite=invite)


@app.get("/api/invites/<token>")
def inspect_invite(token):
    row = get_db().execute(
        "SELECT groups.id, groups.name, invites.expires_at FROM invites "
        "JOIN groups ON groups.id = invites.group_id "
        "WHERE invites.token = ? AND invites.expires_at > ?",
        (token, now()),
    ).fetchone()
    if not row:
        return error("This invite link has expired or been reset.", 404)
    user = current_user()
    already_member = bool(user and group_row(user["id"], row["id"]))
    return jsonify(group={"id": row["id"], "name": row["name"]}, alreadyMember=already_member)


@app.post("/api/invites/<token>/join")
@login_required
def join_group(user, token):
    db = get_db()
    row = db.execute(
        "SELECT group_id FROM invites WHERE token = ? AND expires_at > ?",
        (token, now()),
    ).fetchone()
    if not row:
        return error("This invite link has expired or been reset.", 404)
    group_id = row["group_id"]
    with db:
        db.execute(
            "INSERT OR IGNORE INTO memberships(group_id, user_id, role, joined_at) "
            "VALUES (?, ?, 'member', ?)",
            (group_id, user["id"], now()),
        )
    return jsonify(group=group_payload(group_row(user["id"], group_id)))


@app.patch("/api/groups/<group_id>/members/<member_id>")
@login_required
def change_member_role(user, group_id, member_id):
    if not manager_group(user["id"], group_id):
        return error("Only managers can change roles.", 403)
    role = json_body().get("role")
    if role not in ("member", "manager"):
        return error("Choose member or manager.")
    db = get_db()
    member = db.execute(
        "SELECT role FROM memberships WHERE group_id = ? AND user_id = ?",
        (group_id, member_id),
    ).fetchone()
    if not member:
        return error("Member unavailable.", 404)
    if member["role"] == "manager" and role == "member":
        count = db.execute(
            "SELECT COUNT(*) FROM memberships WHERE group_id = ? AND role = 'manager'",
            (group_id,),
        ).fetchone()[0]
        if count <= 1:
            return error("Promote another manager first.", 409)
    with db:
        db.execute(
            "UPDATE memberships SET role = ? WHERE group_id = ? AND user_id = ?",
            (role, group_id, member_id),
        )
    return jsonify(role=role)


@app.delete("/api/groups/<group_id>/members/<member_id>")
@login_required
def remove_member(user, group_id, member_id):
    if not manager_group(user["id"], group_id):
        return error("Only managers can remove members.", 403)
    if member_id == user["id"]:
        return error("Use Leave group for your own membership.")
    db = get_db()
    member = db.execute(
        "SELECT role FROM memberships WHERE group_id = ? AND user_id = ?",
        (group_id, member_id),
    ).fetchone()
    if not member:
        return error("Member unavailable.", 404)
    if member["role"] == "manager":
        managers = db.execute(
            "SELECT COUNT(*) FROM memberships WHERE group_id = ? AND role = 'manager'",
            (group_id,),
        ).fetchone()[0]
        if managers <= 1:
            return error("Promote another manager first.", 409)
    with db:
        db.execute(
            "DELETE FROM gif_groups WHERE group_id = ? AND gif_id IN "
            "(SELECT id FROM gifs WHERE owner_id = ?)",
            (group_id, member_id),
        )
        db.execute(
            "DELETE FROM memberships WHERE group_id = ? AND user_id = ?",
            (group_id, member_id),
        )
        reset_invite(db, group_id)
    return jsonify(removed=True)


@app.post("/api/groups/<group_id>/leave")
@login_required
def leave_group(user, group_id):
    group = group_row(user["id"], group_id)
    if not group:
        return error("Group unavailable.", 404)
    db = get_db()
    if group["role"] == "manager":
        managers = db.execute(
            "SELECT COUNT(*) FROM memberships WHERE group_id = ? AND role = 'manager'",
            (group_id,),
        ).fetchone()[0]
        if managers <= 1:
            return error("Promote another manager or end the group first.", 409)
    with db:
        db.execute(
            "DELETE FROM gif_groups WHERE group_id = ? AND gif_id IN "
            "(SELECT id FROM gifs WHERE owner_id = ?)",
            (group_id, user["id"]),
        )
        db.execute(
            "DELETE FROM memberships WHERE group_id = ? AND user_id = ?",
            (group_id, user["id"]),
        )
    return jsonify(left=True)


@app.delete("/api/groups/<group_id>")
@login_required
def end_group(user, group_id):
    if not manager_group(user["id"], group_id):
        return error("Only managers can end a group.", 403)
    with get_db():
        get_db().execute("DELETE FROM groups WHERE id = ?", (group_id,))
    return jsonify(ended=True)


def normalize_tags(raw: object) -> list[str] | None:
    if not isinstance(raw, list) or len(raw) > 8:
        return None
    tags = []
    for value in raw:
        if not isinstance(value, str):
            return None
        tag = " ".join(value.strip().casefold().split())
        if not tag or len(tag) > 32:
            return None
        if tag not in tags:
            tags.append(tag)
    return tags


def normalize_group_ids(raw: object, user_id: str) -> list[str] | None:
    if not isinstance(raw, list) or len(raw) > 50:
        return None
    group_ids = []
    for value in raw:
        if not isinstance(value, str) or not group_row(user_id, value):
            return None
        if value not in group_ids:
            group_ids.append(value)
    return group_ids


def gif_access(user_id: str, gif_id: str):
    return get_db().execute(
        "SELECT gifs.* FROM gifs WHERE gifs.id = ? AND (gifs.owner_id = ? OR EXISTS ("
        "SELECT 1 FROM gif_groups JOIN memberships ON memberships.group_id = gif_groups.group_id "
        "WHERE gif_groups.gif_id = gifs.id AND memberships.user_id = ?))",
        (gif_id, user_id, user_id),
    ).fetchone()


def gif_payload(row, viewer_id: str) -> dict:
    db = get_db()
    tags = [
        item["tag"]
        for item in db.execute(
            "SELECT tag FROM gif_tags WHERE gif_id = ? ORDER BY tag", (row["id"],)
        ).fetchall()
    ]
    if row["owner_id"] == viewer_id:
        group_ids = [
            item["group_id"]
            for item in db.execute(
                "SELECT group_id FROM gif_groups WHERE gif_id = ?", (row["id"],)
            ).fetchall()
        ]
    else:
        group_ids = [
            item["group_id"]
            for item in db.execute(
                "SELECT gif_groups.group_id FROM gif_groups "
                "JOIN memberships ON memberships.group_id = gif_groups.group_id "
                "WHERE gif_groups.gif_id = ? AND memberships.user_id = ?",
                (row["id"], viewer_id),
            ).fetchall()
        ]
    owner = db.execute(
        "SELECT display_name FROM users WHERE id = ?", (row["owner_id"],)
    ).fetchone()
    return {
        "id": row["id"],
        "ownerId": row["owner_id"],
        "ownerName": owner["display_name"] or "Unnamed member",
        "owned": row["owner_id"] == viewer_id,
        "tags": tags,
        "groupIds": group_ids,
        "createdAt": row["created_at"],
        "sizeBytes": row["size_bytes"],
        "fileUrl": f"/api/gifs/{row['id']}/file",
        "posterUrl": f"/api/gifs/{row['id']}/poster",
    }


def gif_list(user_id: str, owner_id: str | None = None, group_id: str | None = None):
    db = get_db()
    tag = request.args.get("tag", "").strip().casefold()
    creator = request.args.get("creator", "").strip()
    if owner_id:
        sql = "SELECT DISTINCT gifs.* FROM gifs WHERE gifs.owner_id = ?"
        params: list = [owner_id]
    else:
        sql = (
            "SELECT DISTINCT gifs.* FROM gifs JOIN gif_groups ON gif_groups.gif_id = gifs.id "
            "WHERE gif_groups.group_id = ?"
        )
        params = [group_id]
    if tag:
        sql += " AND EXISTS (SELECT 1 FROM gif_tags WHERE gif_tags.gif_id = gifs.id AND tag = ?)"
        params.append(tag)
    if creator and not owner_id:
        sql += " AND gifs.owner_id = ?"
        params.append(creator)
    sql += " ORDER BY gifs.created_at DESC"
    rows = db.execute(sql, params).fetchall()
    return [gif_payload(row, user_id) for row in rows]


@app.get("/api/gifs")
@login_required
def own_gifs(user):
    return jsonify(gifs=gif_list(user["id"], owner_id=user["id"]))


@app.get("/api/groups/<group_id>/gifs")
@login_required
def group_gifs(user, group_id):
    if not group_row(user["id"], group_id):
        return error("Group unavailable.", 404)
    return jsonify(gifs=gif_list(user["id"], group_id=group_id))


@app.get("/api/groups/<group_id>/random")
@login_required
def random_group_gif(user, group_id):
    if not group_row(user["id"], group_id):
        return error("Group unavailable.", 404)
    gifs = gif_list(user["id"], group_id=group_id)
    if not gifs:
        return error("No GIFs match those filters.", 404)
    return jsonify(gif=secrets.choice(gifs))


@app.get("/api/gifs/<gif_id>")
@login_required
def get_gif(user, gif_id):
    row = gif_access(user["id"], gif_id)
    return jsonify(gif=gif_payload(row, user["id"])) if row else error("GIF unavailable.", 404)


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
    try:
        tags = normalize_tags(json.loads(request.form.get("tags", "[]")))
        group_ids = normalize_group_ids(json.loads(request.form.get("groupIds", "[]")), user["id"])
    except (ValueError, TypeError):
        return error("Tags or groups are invalid.")
    if tags is None or group_ids is None:
        return error("Tags or groups are invalid.")
    db = get_db()
    existing = db.execute(
        "SELECT * FROM gifs WHERE owner_id = ? AND upload_key = ?",
        (user["id"], upload_key),
    ).fetchone()
    if existing:
        return jsonify(gif=gif_payload(existing, user["id"]))
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
            db.executemany(
                "INSERT INTO gif_tags(gif_id, tag) VALUES (?, ?)",
                [(gif_id, tag) for tag in tags],
            )
            db.executemany(
                "INSERT INTO gif_groups(gif_id, group_id) VALUES (?, ?)",
                [(gif_id, group_id) for group_id in group_ids],
            )
    except Exception:
        gif_path.unlink(missing_ok=True)
        poster_path.unlink(missing_ok=True)
        raise
    row = db.execute("SELECT * FROM gifs WHERE id = ?", (gif_id,)).fetchone()
    return jsonify(gif=gif_payload(row, user["id"])), 201


@app.patch("/api/gifs/<gif_id>")
@login_required
def edit_gif(user, gif_id):
    db = get_db()
    row = db.execute(
        "SELECT * FROM gifs WHERE id = ? AND owner_id = ?", (gif_id, user["id"])
    ).fetchone()
    if not row:
        return error("GIF unavailable.", 404)
    body = json_body()
    tags = normalize_tags(body.get("tags"))
    group_ids = normalize_group_ids(body.get("groupIds"), user["id"])
    if tags is None or group_ids is None:
        return error("Tags or groups are invalid.")
    with db:
        db.execute("DELETE FROM gif_tags WHERE gif_id = ?", (gif_id,))
        db.executemany(
            "INSERT INTO gif_tags(gif_id, tag) VALUES (?, ?)",
            [(gif_id, tag) for tag in tags],
        )
        db.execute("DELETE FROM gif_groups WHERE gif_id = ?", (gif_id,))
        db.executemany(
            "INSERT INTO gif_groups(gif_id, group_id) VALUES (?, ?)",
            [(gif_id, group_id) for group_id in group_ids],
        )
    return jsonify(gif=gif_payload(row, user["id"]))


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


@app.delete("/api/groups/<group_id>/gifs/<gif_id>")
@login_required
def remove_group_gif(user, group_id, gif_id):
    group = group_row(user["id"], group_id)
    if not group:
        return error("Group unavailable.", 404)
    row = get_db().execute(
        "SELECT gifs.owner_id FROM gif_groups JOIN gifs ON gifs.id = gif_groups.gif_id "
        "WHERE gif_groups.group_id = ? AND gif_groups.gif_id = ?",
        (group_id, gif_id),
    ).fetchone()
    if not row:
        return error("GIF unavailable in this group.", 404)
    if group["role"] != "manager" and row["owner_id"] != user["id"]:
        return error("Only the owner or a manager can remove this share.", 403)
    with get_db():
        get_db().execute(
            "DELETE FROM gif_groups WHERE group_id = ? AND gif_id = ?", (group_id, gif_id)
        )
    return jsonify(removed=True)


@app.patch("/api/me")
@login_required
def update_me(user):
    display_name = str(json_body().get("displayName", "")).strip()
    if not 1 <= len(display_name) <= 40:
        return error("Display name must be 1–40 characters.")
    with get_db():
        get_db().execute(
            "UPDATE users SET display_name = ? WHERE id = ?",
            (display_name, user["id"]),
        )
    return jsonify(user={
        "id": user["id"], "email": user["email"], "displayName": display_name
    })


@app.delete("/api/me")
@login_required
def delete_me(user):
    db = get_db()
    sole = db.execute(
        "SELECT groups.id, groups.name FROM groups JOIN memberships mine "
        "ON mine.group_id = groups.id AND mine.user_id = ? AND mine.role = 'manager' "
        "WHERE (SELECT COUNT(*) FROM memberships managers "
        "WHERE managers.group_id = groups.id AND managers.role = 'manager') = 1",
        (user["id"],),
    ).fetchall()
    if sole:
        return jsonify(
            error="Promote another manager or end these groups first.",
            groups=[{"id": row["id"], "name": row["name"]} for row in sole],
        ), 409
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
