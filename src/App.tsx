import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { ReactNode } from "react";
import { useApp } from "./AppContext";
import { SignIn, DisplayName } from "./Auth";
import { Recorder } from "./Recorder";
import { SaveGif, MyGifs, GifDetail } from "./Gifs";
import {
  Groups,
  CreateGroup,
  GroupDrawer,
  GroupManage,
  JoinGroup,
} from "./Groups";
import { Account } from "./Account";

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
  if (!user.displayName && location.pathname !== "/display-name") {
    return (
      <Navigate
        to={`/display-name?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }
  return children;
}

function Shell() {
  const { user } = useApp();
  const location = useLocation();
  const plain = ["/signin", "/display-name"].includes(location.pathname);
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/">
          gif urself<span className="brand-dot">.</span>
        </NavLink>
        {!plain && (
          <nav className="header-nav" aria-label="Main navigation">
            <NavLink to="/">Record</NavLink>
            {user && <NavLink to="/my-gifs">My GIFs</NavLink>}
            {user && <NavLink to="/groups">Groups</NavLink>}
            <NavLink to={user ? "/account" : "/signin"}>
              {user ? "Account" : "Sign in"}
            </NavLink>
          </nav>
        )}
      </header>
      <Routes>
        <Route path="/" element={<Recorder />} />
        <Route path="/signin" element={<SignIn />} />
        <Route
          path="/display-name"
          element={
            <RequireAuth>
              <DisplayName />
            </RequireAuth>
          }
        />
        <Route
          path="/save"
          element={
            <RequireAuth>
              <SaveGif />
            </RequireAuth>
          }
        />
        <Route
          path="/my-gifs"
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
          path="/groups"
          element={
            <RequireAuth>
              <Groups />
            </RequireAuth>
          }
        />
        <Route
          path="/groups/new"
          element={
            <RequireAuth>
              <CreateGroup />
            </RequireAuth>
          }
        />
        <Route
          path="/groups/:groupId"
          element={
            <RequireAuth>
              <GroupDrawer />
            </RequireAuth>
          }
        />
        <Route
          path="/groups/:groupId/manage"
          element={
            <RequireAuth>
              <GroupManage />
            </RequireAuth>
          }
        />
        <Route path="/invite/:token" element={<JoinGroup />} />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!plain && user && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <NavLink to="/">Record</NavLink>
          <NavLink to="/my-gifs">My GIFs</NavLink>
          <NavLink to="/groups">Groups</NavLink>
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return <Shell />;
}
