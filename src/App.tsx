import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { ReactNode } from "react";
import { useApp } from "./AppContext";
import { SignIn } from "./Auth";
import { Recorder } from "./Recorder";
import { MyGifs, GifDetail } from "./Gifs";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useApp();
  const location = useLocation();
  if (!user) {
    return (
      <Navigate
        to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }
  return children;
}

function LegacySaveRedirect() {
  const location = useLocation();
  const editId = new URLSearchParams(location.search).get("edit");
  return (
    <Navigate
      to={editId ? `/gifs/${encodeURIComponent(editId)}` : "/?save=1"}
      replace
    />
  );
}

function LegacyCollectionRedirect() {
  const location = useLocation();
  return <Navigate to={`/gifs${location.search}${location.hash}`} replace />;
}

function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link
          className="site-logo"
          to="/"
          aria-label="gif urself, record a GIF"
        >
          gif urself
        </Link>
        <Link className="site-action" to="/">
          Record a GIF
        </Link>
      </div>
    </header>
  );
}

function Shell() {
  const { user } = useApp();
  const location = useLocation();
  const plain = location.pathname === "/signin";
  const collectionPage =
    location.pathname === "/gifs" || location.pathname.startsWith("/gifs/");

  return (
    <div className="app-shell">
      {user && collectionPage && <SiteHeader />}
      <Routes>
        <Route path="/" element={<Recorder />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/save" element={<LegacySaveRedirect />} />
        <Route path="/my-gifs" element={<LegacyCollectionRedirect />} />
        <Route
          path="/gifs"
          element={
            <RequireAuth>
              <MyGifs />
            </RequireAuth>
          }
        />
        <Route
          path="/gifs/:gifId"
          element={
            <RequireAuth>
              <GifDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/account"
          element={<Navigate to="/gifs#account" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!plain && user && !collectionPage && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <NavLink to="/">Record</NavLink>
          <NavLink
            to="/gifs"
            className={({ isActive }) =>
              isActive || location.pathname.startsWith("/gifs/")
                ? "active"
                : undefined
            }
          >
            Saved GIFs
          </NavLink>
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return <Shell />;
}
