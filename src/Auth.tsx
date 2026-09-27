import { Link, useSearchParams } from "react-router-dom";
import { useApp } from "./AppContext";

function destination(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/gifs";
}

export function SignIn() {
  const { signInConfigured } = useApp();
  const [params] = useSearchParams();
  const next = destination(params.get("next"));

  return (
    <main className="page narrow-page signin-page">
      <Link className="back-link" to="/">
        ← Back
      </Link>
      <h1>
        {next === "/?save=1" || next === "/save" ? "Save GIF" : "Sign in"}
      </h1>
      {signInConfigured && (
        <a
          className="button primary"
          href={`/api/auth/login?next=${encodeURIComponent(next)}`}
        >
          Sign in with email
        </a>
      )}
      {!signInConfigured && (
        <p className="notice warning" role="status">
          Sign-in is being set up.
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
