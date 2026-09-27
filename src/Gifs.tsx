import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AccountSettings } from "./Account";
import { DeleteConfirmation } from "./DeleteConfirmation";
import { api, jsonRequest } from "./api";
import type { Gif } from "./api";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function gifDate(createdAt: number) {
  const date = new Date(createdAt * 1000);
  return {
    dateTime: date.toISOString(),
    label: `${dateFormat.format(date)} · ${timeFormat.format(date)}`,
  };
}

function GifCard({ gif }: { gif: Gif }) {
  const saved = gifDate(gif.createdAt);
  return (
    <Link
      to={`/gifs/${gif.id}`}
      className="gif-card"
      aria-label={`Open GIF saved ${saved.label}`}
    >
      <img src={gif.fileUrl} alt="" loading="lazy" />
    </Link>
  );
}

export function MyGifs() {
  const location = useLocation();
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<{ gifs: Gif[] }>("/api/gifs")
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
  }, []);

  useEffect(() => {
    if (location.hash === "#account") {
      document.getElementById("account")?.scrollIntoView();
    }
  }, [location.hash, gifs.length]);

  return (
    <main className="page gallery-page">
      <header className="content-heading">
        <h1>Saved GIFs</h1>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {gifs.length ? (
        <div className="gif-grid">
          {gifs.map((gif) => (
            <GifCard key={gif.id} gif={gif} />
          ))}
        </div>
      ) : (
        <div className="gallery-empty">
          <p>No GIFs yet</p>
        </div>
      )}
      <AccountSettings />
    </main>
  );
}

export function GifDetail() {
  const { gifId } = useParams();
  const navigate = useNavigate();
  const [gif, setGif] = useState<Gif | null>(null);
  const [error, setError] = useState("");
  const saved = gif ? gifDate(gif.createdAt) : null;

  useEffect(() => {
    if (!gifId) return;
    let active = true;
    void api<{ gif: Gif }>(`/api/gifs/${gifId}`)
      .then(({ gif }) => {
        if (active) {
          setGif(gif);
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

  async function deleteGif() {
    if (!gif) return;
    await api(`/api/gifs/${gif.id}`, jsonRequest("DELETE"));
    navigate("/gifs");
  }

  return (
    <main className="page gif-detail-page">
      <Link className="detail-back utility-link" to="/gifs">
        <span aria-hidden="true">← </span>Saved GIFs
      </Link>
      <header className="content-heading">
        <h1>
          {saved ? (
            <>
              <span className="sr-only">GIF saved </span>
              <time dateTime={saved.dateTime}>{saved.label}</time>
            </>
          ) : error ? (
            "GIF unavailable"
          ) : (
            "Loading GIF…"
          )}
        </h1>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {gif && (
        <>
          <img
            className="gif-preview detail-preview"
            src={gif.fileUrl}
            alt="Saved reaction GIF"
          />
          <div className="detail-actions">
            <a className="button primary" href={`${gif.fileUrl}?download=1`}>
              Download
            </a>
            <DeleteConfirmation
              triggerLabel="Delete"
              title="Delete GIF?"
              description="This GIF will be deleted from your library. Downloaded copies will remain."
              confirmLabel="Delete"
              onConfirm={deleteGif}
            />
          </div>
        </>
      )}
    </main>
  );
}
