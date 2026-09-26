"""High-level API flows with separate browser identities and real GIF bytes."""
import io
import json
import os
import tempfile
import unittest
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

    def account(self, email, name):
        client, headers = self.client()
        response = client.post("/api/auth/request-code", json={"email": email}, headers=headers)
        self.assertEqual(response.status_code, 200, response.json)
        entry = json.loads(Path(server.DATA_DIR, "mail-outbox.jsonl").read_text().splitlines()[-1])
        self.assertEqual(entry["email"], email)
        response = client.post("/api/auth/verify", json={"email": email, "code": entry["code"]}, headers=headers)
        self.assertEqual(response.status_code, 200, response.json)
        user = client.patch("/api/me", json={"displayName": name}, headers=headers).json["user"]
        return client, headers, user

    def post(self, client, headers, path, data):
        response = client.post(path, json=data, headers=headers)
        self.assertLess(response.status_code, 300, response.json)
        return response.json

    def test_group_sharing_and_revocation(self):
        owner, own_headers, owner_user = self.account("owner@example.com", "Owner")
        friend, friend_headers, friend_user = self.account("friend@example.com", "Friend")
        stranger, _, _ = self.account("stranger@example.com", "Stranger")
        first = self.post(owner, own_headers, "/api/groups", {"name": "First"})["group"]
        second = self.post(owner, own_headers, "/api/groups", {"name": "Second"})["group"]
        first_invite = owner.get(f"/api/groups/{first['id']}/invite").json["invite"]["token"]
        second_invite = owner.get(f"/api/groups/{second['id']}/invite").json["invite"]["token"]
        self.assertEqual(stranger.get(f"/api/invites/{first_invite}").status_code, 200)
        self.assertEqual(stranger.get(f"/api/groups/{first['id']}/gifs").status_code, 404)
        self.post(friend, friend_headers, f"/api/invites/{first_invite}/join", {})
        self.post(friend, friend_headers, f"/api/invites/{second_invite}/join", {})
        roster = owner.get(f"/api/groups/{first['id']}/members").json["members"]
        self.assertEqual(next(person for person in roster if person["id"] == friend_user["id"])["email"], "friend@example.com")
        self.assertNotIn("email", friend.get(f"/api/groups/{first['id']}/members").json["members"][0])
        response = owner.post("/api/gifs", data={"file": (sample_gif(), "reaction.gif"), "uploadKey": "unique-upload-123", "tags": json.dumps(["anger"]), "groupIds": json.dumps([first["id"], second["id"]])}, headers=own_headers)
        self.assertEqual(response.status_code, 201, response.json)
        gif = response.json["gif"]
        self.assertEqual(len(owner.get("/api/gifs").json["gifs"]), 1)
        self.assertEqual(friend.get(f"/api/groups/{first['id']}/random?tag=anger").json["gif"]["id"], gif["id"])
        response = friend.get(gif["fileUrl"])
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(stranger.get(gif["fileUrl"]).status_code, 404)
        self.assertEqual(owner.patch(f"/api/groups/{first['id']}/members/{friend_user['id']}", json={"role": "manager"}, headers=own_headers).status_code, 200)
        self.assertIn("email", friend.get(f"/api/groups/{first['id']}/members").json["members"][0])
        self.assertEqual(friend.delete(f"/api/groups/{first['id']}/gifs/{gif['id']}", headers=friend_headers).status_code, 200)
        response = friend.get(gif["fileUrl"])
        self.assertEqual(response.status_code, 200)  # Still shared through Second.
        response.close()
        self.assertEqual(owner.delete(f"/api/groups/{second['id']}/members/{friend_user['id']}", headers=own_headers).status_code, 200)
        self.assertEqual(friend.get(gif["fileUrl"]).status_code, 404)
        response = owner.get(gif["fileUrl"])
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(friend.post(f"/api/invites/{second_invite}/join", json={}, headers=friend_headers).status_code, 404)
        self.assertEqual(owner_user["displayName"], "Owner")

    def test_private_gif_and_csrf(self):
        owner, headers, _ = self.account("private@example.com", "Private")
        response = owner.post("/api/gifs", data={"file": (sample_gif(), "private.gif"), "uploadKey": "private-upload-123", "tags": "[]", "groupIds": "[]"}, headers=headers)
        self.assertEqual(response.status_code, 201, response.json)
        gif = response.json["gif"]
        other, _, _ = self.account("other@example.com", "Other")
        self.assertEqual(other.get(gif["fileUrl"]).status_code, 404)
        self.assertEqual(other.get(gif["posterUrl"]).status_code, 404)
        self.assertEqual(owner.delete(f"/api/gifs/{gif['id']}").status_code, 403)
        self.assertEqual(owner.delete(f"/api/gifs/{gif['id']}", headers=headers).status_code, 200)
        self.assertEqual(owner.get(gif["fileUrl"]).status_code, 404)


if __name__ == "__main__":
    unittest.main()
