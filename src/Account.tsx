import { useState } from "react";
import { Button } from "react-aria-components";
import { useApp } from "./AppContext";
import { DeleteConfirmation } from "./DeleteConfirmation";
import { api, jsonRequest } from "./api";

export function AccountSettings() {
  const { user } = useApp();
  const [error, setError] = useState("");

  async function signOut() {
    try {
      await api("/api/auth/signout", jsonRequest("POST"));
      window.location.assign("/");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not sign out.",
      );
    }
  }

  async function deleteAccount() {
    await api("/api/me", jsonRequest("DELETE"));
    window.location.assign("/");
  }

  return (
    <section
      className="account-section"
      id="account"
      aria-labelledby="account-heading"
    >
      <h2 id="account-heading">Account</h2>
      <div className="account-content">
        <p className="subtle">Signed in as {user?.email}</p>
        <div className="account-actions">
          <Button
            className="button secondary compact"
            onPress={() => void signOut()}
          >
            Sign out
          </Button>
          <DeleteConfirmation
            triggerLabel="Delete account…"
            title="Delete account?"
            description="Your saved GIFs will be deleted. Downloaded copies will remain."
            confirmLabel="Delete account"
            onConfirm={deleteAccount}
          />
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
