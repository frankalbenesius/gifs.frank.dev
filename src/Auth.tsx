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
  const { user, emailConfigured, pending, setUser } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = destination(params.get("next"));
  const [email, setEmail] = useState(user?.email || "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/request-code", jsonRequest("POST", { email }));
      setStep("code");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not send a code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>(
        "/api/auth/verify",
        jsonRequest("POST", { email, code }),
      );
      setUser(result.user);
      navigate(
        result.user.displayName
          ? next
          : `/display-name?next=${encodeURIComponent(next)}`,
        {
          replace: true,
        },
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not verify that code.",
      );
    } finally {
      setBusy(false);
    }
  }

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
      {step === "email" ? (
        <form className="stack" onSubmit={(event) => void send(event)}>
          <TextField
            type="email"
            value={email}
            onChange={setEmail}
            isRequired
            autoComplete="email"
          >
            <Label>Email address</Label>
            <Input placeholder="you@example.com" />
          </TextField>
          <Button
            className="button primary"
            type="submit"
            isDisabled={busy || !emailConfigured}
          >
            {busy ? "Sending…" : "Send code"}
          </Button>
          {!emailConfigured && (
            <p className="notice warning" role="status">
              Email sign-in is waiting for a mail relay. Recording and
              downloading still work.
            </p>
          )}
          <p className="subtle">
            If this email is new, we’ll make a private account for it.
          </p>
        </form>
      ) : (
        <form className="stack" onSubmit={(event) => void verify(event)}>
          <p>
            Code sent to <strong>{email}</strong>.
          </p>
          <TextField
            value={code}
            onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            isRequired
          >
            <Label>Six-digit code</Label>
            <Input placeholder="000000" maxLength={6} />
          </TextField>
          <Button
            className="button primary"
            type="submit"
            isDisabled={busy || code.length !== 6}
          >
            {busy ? "Checking…" : "Continue"}
          </Button>
          <div className="split-links">
            <Button
              className="text-button"
              onPress={() => void send()}
              isDisabled={busy}
            >
              Resend code
            </Button>
            <Button
              className="text-button"
              onPress={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              Change email
            </Button>
          </div>
        </form>
      )}
      {pending && (
        <p className="notice">
          Your GIF stays in this browser until you save it.
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
