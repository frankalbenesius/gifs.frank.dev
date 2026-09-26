import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  Checkbox,
  Input,
  Label,
  TextField,
} from "react-aria-components";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useApp } from "./AppContext";
import { api, jsonRequest } from "./api";
import type { Gif, Group } from "./api";
import { MembersDialog } from "./MembersDialog";

const SUGGESTED_TAGS = ["wow", "anger", "fear", "laugh", "nope", "confused"];

function lastGroupsKey(userId: string): string {
  return `gif-urself-last-groups-${userId}`;
}

function readLastGroups(userId: string): string[] {
  try {
    const result: unknown = JSON.parse(
      localStorage.getItem(lastGroupsKey(userId)) || "[]",
    );
    return Array.isArray(result)
      ? result.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function SaveGif() {
  const { user, pending, discardPending } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get("edit");
  const addGroup = params.get("addGroup");
  const [groups, setGroups] = useState<Group[]>([]);
  const [existing, setExisting] = useState<Gif | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [preview, setPreview] = useState("");
  const [roster, setRoster] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const uploadKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (editId || !pending) return;
    const url = URL.createObjectURL(pending);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [editId, pending]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function load() {
      try {
        const [groupResult, gifResult] = await Promise.all([
          api<{ groups: Group[] }>("/api/groups"),
          editId
            ? api<{ gif: Gif }>(`/api/gifs/${editId}`)
            : Promise.resolve(null),
        ]);
        if (!active) return;
        setGroups(groupResult.groups);
        if (gifResult) {
          setExisting(gifResult.gif);
          setTags(gifResult.gif.tags);
          setSelected([
            ...new Set([
              ...gifResult.gif.groupIds,
              ...(addGroup &&
              groupResult.groups.some((group) => group.id === addGroup)
                ? [addGroup]
                : []),
            ]),
          ]);
          setPreview(gifResult.gif.fileUrl);
        } else {
          const available = new Set(
            groupResult.groups.map((group) => group.id),
          );
          setSelected(
            readLastGroups(user!.id).filter((groupId) =>
              available.has(groupId),
            ),
          );
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load the save form.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [user, editId, addGroup]);

  function toggleGroup(groupId: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, groupId] : current.filter((id) => id !== groupId),
    );
  }

  function addTag(value: string) {
    const tag = value.trim().toLocaleLowerCase();
    if (tag && tag.length <= 32 && tags.length < 8 && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setNewTag("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || (!editId && !pending)) return;
    setSaving(true);
    setError("");
    try {
      let result: { gif: Gif };
      if (editId) {
        result = await api<{ gif: Gif }>(
          `/api/gifs/${editId}`,
          jsonRequest("PATCH", { tags, groupIds: selected }),
        );
      } else {
        const form = new FormData();
        form.append("file", pending!, "reaction.gif");
        form.append("uploadKey", uploadKey.current);
        form.append("tags", JSON.stringify(tags));
        form.append("groupIds", JSON.stringify(selected));
        result = await api<{ gif: Gif }>("/api/gifs", {
          method: "POST",
          body: form,
        });
        localStorage.setItem(lastGroupsKey(user.id), JSON.stringify(selected));
        await discardPending();
      }
      navigate(`/gifs/${result.gif.id}`, { replace: true });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save this GIF.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="page narrow-page">
        <p>Loading save form…</p>
      </main>
    );
  if (!editId && !pending) {
    return (
      <main className="page narrow-page">
        <h1>Your recording is gone</h1>
        <p>
          The GIF was not uploaded. Record another or use a copy you downloaded.
        </p>
        <Link className="button primary" to="/">
          Record a GIF
        </Link>
      </main>
    );
  }
  if (editId && existing && !existing.owned) {
    return (
      <main className="page narrow-page">
        <p>Only the GIF owner can edit it.</p>
      </main>
    );
  }
  const selectedNames = groups
    .filter((group) => selected.includes(group.id))
    .map((group) => group.name);
  const cancelHref = editId ? `/gifs/${editId}` : "/";

  return (
    <main className="page narrow-page save-page">
      <Link className="back-link" to={cancelHref}>
        ← Cancel
      </Link>
      <div className="page-kicker">
        {editId ? "Make a change" : "Keep this one"}
      </div>
      <h1>{editId ? "Edit GIF" : "Save GIF"}</h1>
      {preview && (
        <img className="gif-preview" src={preview} alt="GIF you are saving" />
      )}
      <form onSubmit={(event) => void save(event)}>
        <section className="form-section">
          <h2>
            Reaction tags <span className="optional">optional</span>
          </h2>
          <p className="subtle">How should people find this reaction?</p>
          <div className="tag-row">
            {SUGGESTED_TAGS.map((tag) => (
              <Button
                key={tag}
                className={`tag-pill ${tags.includes(tag) ? "selected" : ""}`}
                onPress={() =>
                  setTags(
                    tags.includes(tag)
                      ? tags.filter((item) => item !== tag)
                      : tags.length < 8
                        ? [...tags, tag]
                        : tags,
                  )
                }
              >
                {tag}
              </Button>
            ))}
          </div>
          <div className="inline-field">
            <TextField value={newTag} onChange={setNewTag}>
              <Label>Custom tag</Label>
              <Input maxLength={32} placeholder="Type your own" />
            </TextField>
            <Button
              className="button secondary"
              type="button"
              onPress={() => addTag(newTag)}
              isDisabled={!newTag.trim()}
            >
              Add
            </Button>
          </div>
          {tags.length > 0 && <p className="subtle">Tags: {tags.join(", ")}</p>}
        </section>
        <section className="form-section">
          <h2>Share with groups</h2>
          <p className="subtle">
            Choose who can see this GIF. You can change this later.
          </p>
          {groups.length === 0 ? (
            <p className="notice">
              No groups yet. This GIF will be saved privately.{" "}
              <Link to="/groups/new">Create a group</Link> later to share it.
            </p>
          ) : (
            <div className="group-choices">
              {groups.map((group) => (
                <div className="group-choice" key={group.id}>
                  <Checkbox
                    isSelected={selected.includes(group.id)}
                    onChange={(checked) => toggleGroup(group.id, checked)}
                  >
                    <span className="check-square" aria-hidden="true" />
                    <span>{group.name}</span>
                  </Checkbox>
                  <Button
                    className="text-button"
                    type="button"
                    onPress={() => setRoster(group)}
                  >
                    {group.memberCount} members
                  </Button>
                </div>
              ))}
            </div>
          )}
          {selected.length > 0 && (
            <p className="notice">
              Members of selected groups can view and download this GIF.
            </p>
          )}
        </section>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="save-footer">
          <p className="audience-summary">
            {selectedNames.length
              ? `Sharing with: ${selectedNames.join(", ")}`
              : "Only you can see this GIF"}
          </p>
          <Button
            className="button primary"
            type="submit"
            isDisabled={saving || (!!editId && !existing)}
          >
            {saving
              ? "Saving…"
              : editId
                ? "Save changes"
                : selected.length
                  ? `Save and share · ${selected.length} ${selected.length === 1 ? "group" : "groups"}`
                  : "Save privately"}
          </Button>
        </div>
      </form>
      {roster && (
        <MembersDialog
          groupId={roster.id}
          groupName={roster.name}
          open
          onClose={() => setRoster(null)}
        />
      )}
    </main>
  );
}

export function GifCard({ gif, to }: { gif: Gif; to: string }) {
  return (
    <Link to={to} className="gif-card">
      <img
        src={gif.posterUrl}
        alt={`Reaction GIF by ${gif.ownerName}`}
        loading="lazy"
      />
      <span className="gif-card-meta">
        <strong>{gif.tags.length ? gif.tags.join(" · ") : "untagged"}</strong>
        <small>
          {gif.owned
            ? gif.groupIds.length
              ? `${gif.groupIds.length} groups`
              : "private"
            : gif.ownerName}
        </small>
      </span>
    </Link>
  );
}

export function MyGifs() {
  const [params] = useSearchParams();
  const shareTo = params.get("shareTo");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [tag, setTag] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<{ gifs: Gif[] }>(
      `/api/gifs${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`,
    )
      .then((result) => {
        if (active) setGifs(result.gifs);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load your GIFs.",
          );
      });
    return () => {
      active = false;
    };
  }, [tag]);

  return (
    <main className="page gallery-page">
      <div className="page-heading">
        <div>
          <div className="page-kicker">Your little library</div>
          <h1>My GIFs</h1>
          {shareTo && <p>Choose a GIF to share with your group.</p>}
        </div>
        <Link className="button primary compact" to="/">
          Record a GIF
        </Link>
      </div>
      <TextField className="search-field" value={tag} onChange={setTag}>
        <Label>Filter by tag</Label>
        <Input placeholder="Try anger, wow, or your own tag" />
      </TextField>
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
              to={`/gifs/${gif.id}${shareTo ? `?shareTo=${shareTo}` : ""}`}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>{tag ? "No GIFs with that tag" : "Nothing saved yet"}</h2>
          <p>
            {tag
              ? "Clear the filter to see everything you saved."
              : "The recorder is ready whenever you are."}
          </p>
          {tag ? (
            <Button className="button secondary" onPress={() => setTag("")}>
              Clear filter
            </Button>
          ) : (
            <Link className="button primary" to="/">
              Record a GIF
            </Link>
          )}
        </div>
      )}
    </main>
  );
}

export function GifDetail() {
  const { gifId } = useParams();
  const [params] = useSearchParams();
  const groupId = params.get("group");
  const shareTo = params.get("shareTo");
  const tag = params.get("tag") || "";
  const creator = params.get("creator") || "";
  const navigate = useNavigate();
  const [gif, setGif] = useState<Gif | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gifId) return;
    let active = true;
    Promise.all([
      api<{ gif: Gif }>(`/api/gifs/${gifId}`),
      api<{ groups: Group[] }>("/api/groups"),
    ])
      .then(([gifResult, groupResult]) => {
        if (active) {
          setGif(gifResult.gif);
          setGroups(groupResult.groups);
        }
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "GIF unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [gifId]);

  const currentGroup = useMemo(
    () => groups.find((group) => group.id === groupId),
    [groups, groupId],
  );
  const shareGroup = useMemo(
    () => groups.find((group) => group.id === shareTo),
    [groups, shareTo],
  );
  const backHref = groupId ? `/groups/${groupId}` : "/my-gifs";

  async function deleteGif() {
    if (
      !gif ||
      !window.confirm(
        "Delete this GIF from your library and every group? Downloads people already made cannot be recalled.",
      )
    )
      return;
    try {
      await api(`/api/gifs/${gif.id}`, jsonRequest("DELETE"));
      navigate("/my-gifs");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not delete this GIF.",
      );
    }
  }

  async function removeFromGroup() {
    if (
      !gif ||
      !groupId ||
      !window.confirm("Remove this GIF from this group? The owner keeps it.")
    )
      return;
    try {
      await api(`/api/groups/${groupId}/gifs/${gif.id}`, jsonRequest("DELETE"));
      navigate(`/groups/${groupId}`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not remove this GIF.",
      );
    }
  }

  async function tryAnother() {
    if (!groupId) return;
    try {
      const query = new URLSearchParams({ tag, creator });
      const result = await api<{ gif: Gif }>(
        `/api/groups/${groupId}/random?${query}`,
      );
      navigate(
        `/gifs/${result.gif.id}?group=${groupId}&tag=${encodeURIComponent(tag)}&creator=${encodeURIComponent(creator)}&random=1`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "No other GIF matched.",
      );
    }
  }

  return (
    <main className="page narrow-page">
      <Link className="back-link" to={backHref}>
        ← {currentGroup?.name || "My GIFs"}
      </Link>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {gif && (
        <>
          <div className="page-kicker">Reaction by {gif.ownerName}</div>
          <h1>{gif.tags.length ? gif.tags.join(" · ") : "A reaction"}</h1>
          <img
            className="gif-preview"
            src={gif.fileUrl}
            alt={`GIF by ${gif.ownerName}`}
          />
          {gif.owned ? (
            <p className="audience-line">
              {gif.groupIds.length
                ? `Shared with: ${groups
                    .filter((group) => gif.groupIds.includes(group.id))
                    .map((group) => group.name)
                    .join(", ")}`
                : "Only you can see this GIF"}
            </p>
          ) : (
            <p className="audience-line">
              Shared in {currentGroup?.name || "your group"}
            </p>
          )}
          <div className="detail-actions">
            <a className="button secondary" href={`${gif.fileUrl}?download=1`}>
              Download
            </a>
            {gif.owned && (
              <Link className="button primary" to={`/save?edit=${gif.id}`}>
                Edit tags & sharing
              </Link>
            )}
            {shareGroup && gif.owned && (
              <Link
                className="button primary"
                to={`/save?edit=${gif.id}&addGroup=${shareGroup.id}`}
              >
                Share with {shareGroup.name}
              </Link>
            )}
            {groupId && params.get("random") && (
              <Button
                className="button secondary"
                onPress={() => void tryAnother()}
              >
                Try another
              </Button>
            )}
            {groupId && currentGroup?.role === "manager" && !gif.owned && (
              <Button
                className="button secondary"
                onPress={() => void removeFromGroup()}
              >
                Remove from this group
              </Button>
            )}
            {gif.owned && (
              <Button
                className="text-button danger"
                onPress={() => void deleteGif()}
              >
                Delete GIF
              </Button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
