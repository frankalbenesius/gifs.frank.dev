import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "./AppContext";
import { api, jsonRequest } from "./api";
import type { User } from "./api";

export function Account() {
  const { user, setUser } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.displayName || "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>(
        "/api/me",
        jsonRequest("PATCH", { displayName: name }),
      );
      setUser(result.user);
      setNotice("Name saved.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save your name.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    try {
      await api("/api/auth/signout", jsonRequest("POST"));
      setUser(null);
      navigate("/");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not sign out.",
      );
    }
  }
  async function deleteAccount() {
    if (
      !window.confirm(
        "Delete your account and all GIFs you own? People may still have copies they downloaded.",
      )
    )
      return;
    try {
      await api("/api/me", jsonRequest("DELETE"));
      setUser(null);
      navigate("/");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not delete your account.",
      );
    }
  }
  return (
    <main className="page narrow-page">
      <div className="page-kicker">Your settings</div>
      <h1>Account</h1>
      <section className="form-section">
        <h2>Identity</h2>
        <p className="subtle">Signed in as {user?.email}</p>
        <form className="stack" onSubmit={(event) => void save(event)}>
          <TextField value={name} onChange={setName} isRequired>
            <Label>Display name</Label>
            <Input maxLength={40} />
          </TextField>
          <Button
            className="button primary"
            type="submit"
            isDisabled={busy || !name.trim()}
          >
            {busy ? "Saving…" : "Save name"}
          </Button>
        </form>
      </section>
      <section className="form-section">
        <h2>Your library</h2>
        <p>
          GIFs you save stay private unless you choose groups to share them
          with.
        </p>
        <Link className="button secondary" to="/my-gifs">
          My GIFs
        </Link>
      </section>
      <section className="form-section">
        <Button className="button secondary" onPress={() => void signOut()}>
          Sign out
        </Button>
      </section>
      <section className="form-section danger-zone">
        <h2>Delete account</h2>
        <p className="subtle">
          This deletes your GIFs from every group. If you are a group's only
          manager, promote someone or end the group first.
        </p>
        <Button
          className="text-button danger"
          onPress={() => void deleteAccount()}
        >
          Delete account and GIFs
        </Button>
      </section>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
