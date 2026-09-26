import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp } from "./AppContext";
import { api, jsonRequest } from "./api";
import type { User } from "./api";

function destination(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/my-gifs";
}

export function SignIn() {
  const { signInConfigured, pending } = useApp();
  const [params] = useSearchParams();
  const next = destination(params.get("next"));

  return (
    <main className="page narrow-page">
      <Link className="back-link" to={pending ? "/" : next}>
        ← Back
      </Link>
      <div className="page-kicker">Your private GIF library</div>
      <h1>
        {next === "/save"
          ? "Save your GIF"
          : next.startsWith("/invite/")
            ? "Join a group"
            : "Sign in"}
      </h1>
      <p className="intro">A code by email. No password to remember.</p>
      {signInConfigured && <a className="button primary" href={`/api/auth/login?next=${encodeURIComponent(next)}`}>
        Continue with email
      </a>}
      {!signInConfigured && <p className="notice warning" role="status">Sign-in is being set up.</p>}
      <p className="subtle">If this email is new, we’ll make a private account for it.</p>
      {pending && (
        <p className="notice">
          Your GIF stays in this browser until you save it.
        </p>
      )}
      {params.get("error") && (
        <p className="notice error" role="alert">
          Sign-in could not be completed. Please try again.
        </p>
      )}
    </main>
  );
}

export function DisplayName() {
  const { user, setUser } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.displayName || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      navigate(destination(params.get("next")), { replace: true });
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

  return (
    <main className="page narrow-page">
      <div className="page-kicker">One quick thing</div>
      <h1>What should we call you?</h1>
      <p className="intro">
        People in your groups will see this name. You can change it later.
      </p>
      <form className="stack" onSubmit={(event) => void save(event)}>
        <TextField value={name} onChange={setName} isRequired>
          <Label>Display name</Label>
          <Input autoFocus maxLength={40} placeholder="Your name" />
        </TextField>
        <Button
          className="button primary"
          type="submit"
          isDisabled={busy || !name.trim()}
        >
          {busy ? "Saving…" : "Continue"}
        </Button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
