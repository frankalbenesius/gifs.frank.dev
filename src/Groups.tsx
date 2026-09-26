import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useApp } from "./AppContext";
import { api, jsonRequest } from "./api";
import type { Gif, Group, Invite, Member } from "./api";
import { GifCard } from "./Gifs";
import { MembersDialog } from "./MembersDialog";

const suggestions = ["wow", "anger", "fear", "laugh", "nope", "confused"];
function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : "Something went wrong.";
}

export function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ groups: Group[] }>("/api/groups")
      .then((result) => setGroups(result.groups))
      .catch((failure) => setError(message(failure)));
  }, []);
  return (
    <main className="page gallery-page">
      <div className="page-heading">
        <div>
          <div className="page-kicker">People you know</div>
          <h1>Groups</h1>
          <p className="intro">Small, private collections of reactions.</p>
        </div>
        <Link className="button primary compact" to="/groups/new">
          Create group
        </Link>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {groups.length ? (
        <div className="group-grid">
          {groups.map((group) => (
            <Link
              className="group-card"
              key={group.id}
              to={`/groups/${group.id}`}
            >
              <strong>{group.name}</strong>
              <span>
                {group.memberCount}{" "}
                {group.memberCount === 1 ? "person" : "people"} · {group.role}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>Make a space for your people</h2>
          <p>
            Create a group, then send its invite link to your friends or team.
          </p>
          <Link className="button primary" to="/groups/new">
            Create group
          </Link>
        </div>
      )}
      <p className="subtle">Have an invite link? Open it to join.</p>
    </main>
  );
}

export function CreateGroup() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ group: Group }>(
        "/api/groups",
        jsonRequest("POST", { name }),
      );
      navigate(`/groups/${result.group.id}`, { replace: true });
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page narrow-page">
      <Link className="back-link" to="/groups">
        ← Groups
      </Link>
      <div className="page-kicker">A space for your people</div>
      <h1>Create a group</h1>
      <p className="intro">
        Only people with an invite can join. Your existing GIFs stay private
        until you choose to share them.
      </p>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <TextField value={name} onChange={setName} isRequired>
          <Label>Group name</Label>
          <Input maxLength={60} placeholder="Friday crew" />
        </TextField>
        <Button
          className="button primary"
          type="submit"
          isDisabled={busy || !name.trim()}
        >
          {busy ? "Creating…" : "Create group"}
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

export function GroupDrawer() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tag, setTag] = useState("");
  const [creator, setCreator] = useState("");
  const [roster, setRoster] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!groupId) return;
    void Promise.all([
      api<{ group: Group }>(`/api/groups/${groupId}`),
      api<{ members: Member[] }>(`/api/groups/${groupId}/members`),
    ])
      .then(([groupResult, memberResult]) => {
        setGroup(groupResult.group);
        setMembers(memberResult.members);
      })
      .catch((failure) => setError(message(failure)));
  }, [groupId]);
  useEffect(() => {
    if (!groupId) return;
    const query = new URLSearchParams({ tag, creator });
    let active = true;
    void api<{ gifs: Gif[] }>(`/api/groups/${groupId}/gifs?${query}`)
      .then((result) => {
        if (active) setGifs(result.gifs);
      })
      .catch((failure) => {
        if (active) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, [groupId, tag, creator]);
  async function random() {
    try {
      const query = new URLSearchParams({ tag, creator });
      const result = await api<{ gif: Gif }>(
        `/api/groups/${groupId}/random?${query}`,
      );
      navigate(
        `/gifs/${result.gif.id}?group=${groupId}&tag=${encodeURIComponent(tag)}&creator=${encodeURIComponent(creator)}&random=1`,
      );
    } catch (failure) {
      setError(message(failure));
    }
  }
  async function leave() {
    if (
      !group ||
      !window.confirm(
        `Leave ${group.name}? Your GIFs will be removed from this group.`,
      )
    )
      return;
    try {
      await api(`/api/groups/${group.id}/leave`, jsonRequest("POST"));
      navigate("/groups");
    } catch (failure) {
      setError(message(failure));
    }
  }
  return (
    <main className="page gallery-page">
      <Link className="back-link" to="/groups">
        ← Groups
      </Link>
      {group && (
        <>
          <div className="page-heading">
            <div>
              <div className="page-kicker">Private group</div>
              <h1>{group.name}</h1>
              <Button className="text-button" onPress={() => setRoster(true)}>
                {group.memberCount}{" "}
                {group.memberCount === 1 ? "person" : "people"} · View people
              </Button>
            </div>
            <div className="heading-actions">
              <Link
                className="button secondary compact"
                to={`/my-gifs?shareTo=${group.id}`}
              >
                Share a GIF
              </Link>
              <Link className="button primary compact" to="/">
                Record one
              </Link>
            </div>
          </div>
          <div className="filter-panel">
            <TextField className="search-field" value={tag} onChange={setTag}>
              <Label>Reaction tag</Label>
              <Input placeholder="Search a reaction" />
            </TextField>
            <label className="select-field">
              From
              <select
                value={creator}
                onChange={(event) => setCreator(event.target.value)}
              >
                <option value="">Anyone here</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <Button
              className="button secondary compact"
              onPress={() => void random()}
              isDisabled={!gifs.length}
            >
              Random GIF
            </Button>
          </div>
          <div className="tag-row filter-tags">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                className={`tag-pill ${tag === suggestion ? "selected" : ""}`}
                onPress={() => setTag(tag === suggestion ? "" : suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {gifs.length ? (
            <div className="gif-grid">
              {gifs.map((gif) => (
                <GifCard
                  key={gif.id}
                  gif={gif}
                  to={`/gifs/${gif.id}?group=${group.id}`}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>{tag || creator ? "No GIFs match" : "No GIFs here yet"}</h2>
              <p>
                {tag || creator
                  ? "Try another tag or person."
                  : "Share a GIF from your library or record a new one."}
              </p>
            </div>
          )}
          <div className="group-bottom">
            {group.role === "manager" && (
              <Link to={`/groups/${group.id}/manage`}>Manage group</Link>
            )}
            <Button className="text-button danger" onPress={() => void leave()}>
              Leave group
            </Button>
          </div>
          {roster && (
            <MembersDialog
              groupId={group.id}
              groupName={group.name}
              open
              onClose={() => setRoster(false)}
            />
          )}
        </>
      )}
    </main>
  );
}

export function GroupManage() {
  const { groupId } = useParams();
  const { user } = useApp();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  async function refresh() {
    const [groupResult, memberResult, inviteResult] = await Promise.all([
      api<{ group: Group }>(`/api/groups/${groupId}`),
      api<{ members: Member[] }>(`/api/groups/${groupId}/members`),
      api<{ invite: Invite | null }>(`/api/groups/${groupId}/invite`),
    ]);
    setGroup(groupResult.group);
    setMembers(memberResult.members);
    setInvite(inviteResult.invite);
  }
  useEffect(() => {
    if (groupId) void refresh().catch((failure) => setError(message(failure)));
  }, [groupId]);
  async function reset() {
    try {
      const result = await api<{ invite: Invite }>(
        `/api/groups/${groupId}/invite/reset`,
        jsonRequest("POST"),
      );
      setInvite(result.invite);
      setCopied(false);
    } catch (failure) {
      setError(message(failure));
    }
  }
  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/invite/${invite.token}`,
      );
      setCopied(true);
    } catch {
      setError("Could not copy. Select the link and copy it manually.");
    }
  }
  async function changeRole(member: Member) {
    try {
      await api(
        `/api/groups/${groupId}/members/${member.id}`,
        jsonRequest("PATCH", {
          role: member.role === "manager" ? "member" : "manager",
        }),
      );
      await refresh();
    } catch (failure) {
      setError(message(failure));
    }
  }
  async function remove(member: Member) {
    if (
      !window.confirm(
        `Remove ${member.displayName}? This also resets the invite link.`,
      )
    )
      return;
    try {
      await api(
        `/api/groups/${groupId}/members/${member.id}`,
        jsonRequest("DELETE"),
      );
      await refresh();
    } catch (failure) {
      setError(message(failure));
    }
  }
  async function end() {
    if (
      !group ||
      !window.confirm(
        `End ${group.name}? GIF owners keep their files, but all shares to this group end.`,
      )
    )
      return;
    try {
      await api(`/api/groups/${group.id}`, jsonRequest("DELETE"));
      navigate("/groups");
    } catch (failure) {
      setError(message(failure));
    }
  }
  const managerCount = members.filter(
    (member) => member.role === "manager",
  ).length;
  return (
    <main className="page narrow-page">
      <Link className="back-link" to={`/groups/${groupId}`}>
        ← Group
      </Link>
      <div className="page-kicker">For managers</div>
      <h1>Manage {group?.name || "group"}</h1>
      {group?.role === "manager" && (
        <>
          <section className="form-section">
            <h2>Invite link</h2>
            <p className="subtle">
              Anyone with this link can sign in and join for 30 days. Only
              managers can see and reset it.
            </p>
            {invite ? (
              <>
                <input
                  className="readonly-link"
                  readOnly
                  value={`${window.location.origin}/invite/${invite.token}`}
                  aria-label="Invite link"
                  onFocus={(event) => event.target.select()}
                />
                <p className="subtle">
                  Expires{" "}
                  {new Date(invite.expiresAt * 1000).toLocaleDateString()}
                </p>
                <div className="action-pair">
                  <Button
                    className="button primary"
                    onPress={() => void copy()}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    className="button secondary"
                    onPress={() => void reset()}
                  >
                    Reset link
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="notice">The invite link has expired.</p>
                <Button className="button primary" onPress={() => void reset()}>
                  Make new link
                </Button>
              </>
            )}
          </section>
          <section className="form-section">
            <h2>People</h2>
            <p className="subtle">
              Managers can see verified email addresses to recognize members.
            </p>
            <ul className="manage-members">
              {members.map((member) => (
                <li key={member.id}>
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>{member.email}</small>
                    <span className="role-label">{member.role}</span>
                  </div>
                  <div className="member-actions">
                    {(member.role === "member" || managerCount > 1) && (
                      <Button
                        className="text-button"
                        onPress={() => void changeRole(member)}
                      >
                        {member.role === "manager"
                          ? "Make member"
                          : "Make manager"}
                      </Button>
                    )}
                    {member.id !== user?.id && (
                      <Button
                        className="text-button danger"
                        onPress={() => void remove(member)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="form-section danger-zone">
            <h2>End group</h2>
            <p className="subtle">
              This removes the shared collection. Everyone keeps GIFs they own.
            </p>
            <Button className="button danger-button" onPress={() => void end()}>
              End group
            </Button>
          </section>
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

export function JoinGroup() {
  const { token } = useParams();
  const { user } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [group, setGroup] = useState<{ id: string; name: string } | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (token)
      void api<{ group: { id: string; name: string }; alreadyMember: boolean }>(
        `/api/invites/${token}`,
      )
        .then((result) => {
          setGroup(result.group);
          setAlreadyMember(result.alreadyMember);
        })
        .catch((failure) => setError(message(failure)));
  }, [token]);
  async function join() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ group: Group }>(
        `/api/invites/${token}/join`,
        jsonRequest("POST"),
      );
      navigate(`/groups/${result.group.id}`, { replace: true });
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  const signIn = `/signin?next=${encodeURIComponent(`/invite/${token}${params.toString() ? `?${params}` : ""}`)}`;
  return (
    <main className="page narrow-page">
      <div className="page-kicker">You've been invited</div>
      <h1>{group ? `Join ${group.name}` : "Group invitation"}</h1>
      {group && (
        <>
          <p className="intro">
            Members can view and download GIFs shared here. Your library stays
            private until you choose to share a GIF. Group managers can see your
            verified email address.
          </p>
          {alreadyMember ? (
            <Link className="button primary" to={`/groups/${group.id}`}>
              Open group
            </Link>
          ) : user ? (
            <Button
              className="button primary"
              onPress={() => void join()}
              isDisabled={busy}
            >
              {busy ? "Joining…" : "Join group"}
            </Button>
          ) : (
            <Link className="button primary" to={signIn}>
              Sign in to join
            </Link>
          )}
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
