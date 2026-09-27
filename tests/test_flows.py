"""High-level API flows with separate browser identities and real GIF bytes."""
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from PIL import Image

os.environ.setdefault("MAIL_MODE", "file")
os.environ.setdefault("APP_ENV", "development")
_test_data = tempfile.TemporaryDirectory()
os.environ["DATA_DIR"] = _test_data.name
import server  # noqa: E402


def sample_gif():
    image = Image.new("RGB", (400, 300), "#778855")
    output = io.BytesIO()
    image.save(output, format="GIF")
    output.seek(0)
    return output


class FlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.migrate()

    def client(self):
        client = server.app.test_client()
        csrf = client.get("/api/session").json["csrf"]
        return client, {"X-CSRF-Token": csrf}

    def account(self, email):
        client, headers = self.client()
        response = client.post("/api/auth/request-code", json={"email": email}, headers=headers)
        self.assertEqual(response.status_code, 200, response.json)
        entry = json.loads(Path(server.DATA_DIR, "mail-outbox.jsonl").read_text().splitlines()[-1])
        self.assertEqual(entry["email"], email)
        response = client.post("/api/auth/verify", json={"email": email, "code": entry["code"]}, headers=headers)
        self.assertEqual(response.status_code, 200, response.json)
        user = client.get("/api/session").json["user"]
        return client, headers, user

    def post(self, client, headers, path, data):
        response = client.post(path, json=data, headers=headers)
        self.assertLess(response.status_code, 300, response.json)
        return response.json

    def test_historical_group_shares_are_private(self):
        owner, own_headers, owner_user = self.account("owner@example.com")
        friend, _, friend_user = self.account("friend@example.com")
        response = owner.post("/api/gifs", data={"file": (sample_gif(), "reaction.gif"), "uploadKey": "unique-upload-123"}, headers=own_headers)
        self.assertEqual(response.status_code, 201, response.json)
        gif = response.json["gif"]
        with server.app.app_context():
            db = server.get_db()
            with db:
                db.execute("INSERT INTO groups(id, name, created_at) VALUES (?, ?, ?)", ("old-group", "Old group", server.now()))
                db.execute("INSERT INTO memberships(group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)", ("old-group", owner_user["id"], "manager", server.now()))
                db.execute("INSERT INTO memberships(group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)", ("old-group", friend_user["id"], "member", server.now()))
                db.execute("INSERT INTO gif_groups(gif_id, group_id) VALUES (?, ?)", (gif["id"], "old-group"))
        legacy_upload = owner.post("/api/gifs", data={"file": (sample_gif(), "legacy.gif"), "uploadKey": "legacy-upload-123", "groupIds": json.dumps(["old-group"])}, headers=own_headers)
        self.assertEqual(legacy_upload.status_code, 400)
        self.assertEqual(owner.get("/api/groups").status_code, 404)
        self.assertEqual(friend.get(f"/api/gifs/{gif['id']}").status_code, 404)
        self.assertEqual(friend.get(gif["fileUrl"]).status_code, 404)
        self.assertEqual(friend.get(gif["posterUrl"]).status_code, 404)
        self.assertEqual(owner.get(f"/api/gifs/{gif['id']}").status_code, 200)
        self.assertEqual(owner.delete("/api/me", headers=own_headers).status_code, 200)

    def test_private_gif_and_csrf(self):
        owner, headers, _ = self.account("private@example.com")
        response = owner.post("/api/gifs", data={"file": (sample_gif(), "private.gif"), "uploadKey": "private-upload-123"}, headers=headers)
        self.assertEqual(response.status_code, 201, response.json)
        gif = response.json["gif"]
        other, _, _ = self.account("other@example.com")
        self.assertEqual(other.get(gif["fileUrl"]).status_code, 404)
        self.assertEqual(other.get(gif["posterUrl"]).status_code, 404)
        self.assertEqual(owner.delete(f"/api/gifs/{gif['id']}").status_code, 403)
        self.assertEqual(owner.delete(f"/api/gifs/{gif['id']}", headers=headers).status_code, 200)
        self.assertEqual(owner.get(gif["fileUrl"]).status_code, 404)

    def test_shared_sign_in_keeps_existing_gifs(self):
        owner, headers, existing = self.account("linked@example.com")
        response = owner.post("/api/gifs", data={"file": (sample_gif(), "linked.gif"), "uploadKey": "linked-upload"}, headers=headers)
        self.assertEqual(response.status_code, 201, response.json)
        gif_id = response.json["gif"]["id"]

        class IdentityProvider:
            def authorize_access_token(self):
                return {"userinfo": {"sub": "shared-subject"}}

            def userinfo(self, token):
                return {"sub": "shared-subject", "email": "linked@example.com", "email_verified": True}

        new_browser = server.app.test_client()
        with new_browser.session_transaction() as state:
            state["return_to"] = "/gifs"
        with patch.object(server, "OIDC_READY", True), patch.object(server, "OIDC_ISSUER", "https://auth.frank.dev/api/auth"), patch.object(server.oauth, "frank", IdentityProvider(), create=True):
            result = new_browser.get("/api/auth/oidc/callback")
        self.assertEqual(result.status_code, 302)
        self.assertEqual(result.location, "http://127.0.0.1:5173/gifs")
        self.assertEqual(new_browser.get("/api/session").json["user"]["id"], existing["id"])
        self.assertEqual(new_browser.get("/api/gifs").json["gifs"][0]["id"], gif_id)


if __name__ == "__main__":
    unittest.main()
