import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { loadSession } from "./api";
import type { User } from "./api";
import { clearPending, readPending, writePending } from "./pending";

interface AppState {
  user: User | null;
  emailConfigured: boolean;
  pending: Blob | null;
  pendingWarning: string;
  setUser: (user: User | null) => void;
  savePending: (blob: Blob) => Promise<void>;
  discardPending: () => Promise<void>;
  reloadSession: () => Promise<void>;
}

const Context = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [pending, setPending] = useState<Blob | null>(null);
  const [pendingWarning, setPendingWarning] = useState("");
  const [ready, setReady] = useState(false);

  const reloadSession = useCallback(async () => {
    const session = await loadSession();
    setUser(session.user);
    setEmailConfigured(session.emailConfigured);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([loadSession(), readPending().catch(() => null)])
      .then(([session, recording]) => {
        if (!active) return;
        setUser(session.user);
        setEmailConfigured(session.emailConfigured);
        setPending(recording);
      })
      .catch(() => {
        if (active)
          setPendingWarning("Could not connect to the app. Try reloading.");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const savePending = useCallback(async (blob: Blob) => {
    setPending(blob);
    try {
      await writePending(blob);
      setPendingWarning("");
    } catch {
      setPendingWarning(
        "This GIF is only in this tab. Download it before leaving or reloading.",
      );
    }
  }, []);

  const discardPending = useCallback(async () => {
    setPending(null);
    setPendingWarning("");
    try {
      await clearPending();
    } catch {
      // The in-memory result is gone; a later visit may offer the local copy again.
    }
  }, []);

  const state = useMemo(
    () => ({
      user,
      emailConfigured,
      pending,
      pendingWarning,
      setUser,
      savePending,
      discardPending,
      reloadSession,
    }),
    [
      user,
      emailConfigured,
      pending,
      pendingWarning,
      savePending,
      discardPending,
      reloadSession,
    ],
  );

  if (!ready) return <div className="loading-page">Opening gif urself…</div>;
  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const state = useContext(Context);
  if (!state) throw new Error("AppProvider is missing");
  return state;
}
