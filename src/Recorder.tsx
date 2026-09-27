import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "./AppContext";
import { api } from "./api";
import type { Gif } from "./api";
import {
  addFrame,
  captureFrame,
  createEncoder,
  DURATION_MS,
  finishEncoder,
  FRAME_COUNT,
} from "./encode";

type Phase =
  | "starting"
  | "ready"
  | "countdown"
  | "recording"
  | "encoding"
  | "error";

export function Recorder() {
  const {
    user,
    signInConfigured,
    pending,
    pendingWarning,
    savePending,
    discardPending,
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);
  const active = useRef(true);
  const uploadKey = useRef(crypto.randomUUID());
  const autoSaveStarted = useRef(false);
  const [phase, setPhase] = useState<Phase>("starting");
  const [countdown, setCountdown] = useState(3);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [gifUrl, setGifUrl] = useState("");
  const [savingGif, setSavingGif] = useState(false);
  const [saveError, setSaveError] = useState("");

  const saveGif = useCallback(async () => {
    if (!pending || savingGif) return;
    if (!user) {
      const next = encodeURIComponent("/?save=1");
      window.location.assign(
        signInConfigured
          ? `/api/auth/login?next=${next}`
          : `/signin?next=${next}`,
      );
      return;
    }
    setSavingGif(true);
    setSaveError("");
    const form = new FormData();
    form.append("file", pending, "reaction.gif");
    form.append("uploadKey", uploadKey.current);
    try {
      const result = await api<{ gif: Gif }>("/api/gifs", {
        method: "POST",
        body: form,
      });
      await discardPending();
      navigate(`/gifs/${result.gif.id}`, { replace: true });
    } catch (failure) {
      setSaveError(
        failure instanceof Error ? failure.message : "Could not save this GIF.",
      );
    } finally {
      setSavingGif(false);
    }
  }, [pending, savingGif, user, signInConfigured, navigate, discardPending]);

  useEffect(() => {
    if (
      new URLSearchParams(location.search).get("save") === "1" &&
      user &&
      pending &&
      !autoSaveStarted.current
    ) {
      autoSaveStarted.current = true;
      void saveGif();
    }
  }, [location.search, user, pending, saveGif]);

  useEffect(() => {
    if (!pending) {
      setGifUrl("");
      return;
    }
    const url = URL.createObjectURL(pending);
    setGifUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  useEffect(() => {
    active.current = true;
    if (pending) return;
    let cancelled = false;
    async function startCamera() {
      setPhase("starting");
      setMessage("");
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera unavailable");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setPhase("ready");
      } catch {
        if (!cancelled) {
          setPhase("error");
          setMessage("Camera unavailable. Allow camera access and try again.");
        }
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      active.current = false;
      timers.current.forEach(window.clearInterval);
      timers.current = [];
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [pending]);

  function record() {
    if (phase !== "ready") return;
    setMessage("");
    setPhase("countdown");
    setCountdown(3);
    let remaining = 3;
    const countdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }
      window.clearInterval(countdownTimer);
      startCapture();
    }, 1000);
    timers.current.push(countdownTimer);
  }

  function startCapture() {
    const video = videoRef.current;
    const context = canvasRef.current?.getContext("2d", {
      willReadFrequently: true,
    });
    if (!video || !context || !video.videoWidth || !video.videoHeight) {
      setPhase("error");
      setMessage("The camera was interrupted. Try again.");
      return;
    }
    setPhase("recording");
    setProgress(0);
    const frames: Uint8ClampedArray[] = [];
    const encode = async () => {
      try {
        const encoder = createEncoder(
          context.canvas.width,
          context.canvas.height,
        );
        for (let index = 0; index < frames.length; index += 1) {
          if (!active.current) return;
          addFrame(encoder, frames[index], index);
          if ((index + 1) % 4 === 0) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
        }
        const blob = finishEncoder(encoder);
        if (active.current) void savePending(blob);
      } catch {
        if (active.current) {
          setPhase("ready");
          setMessage("Could not make this GIF. Try recording again.");
        }
      }
    };
    const capture = () => {
      if (!active.current) return;
      try {
        frames.push(captureFrame(context, video));
        setProgress(frames.length / FRAME_COUNT);
        if (frames.length >= FRAME_COUNT) {
          window.clearInterval(recordingTimer);
          setPhase("encoding");
          window.setTimeout(() => void encode(), 0);
        }
      } catch {
        window.clearInterval(recordingTimer);
        setPhase("ready");
        setMessage("The camera was interrupted. Try again.");
      }
    };
    const recordingTimer = window.setInterval(
      capture,
      DURATION_MS / FRAME_COUNT,
    );
    timers.current.push(recordingTimer);
    capture();
  }

  async function startOver() {
    await discardPending();
    uploadKey.current = crypto.randomUUID();
    autoSaveStarted.current = false;
    setProgress(0);
    setMessage("");
    setSaveError("");
  }

  const recordLabel =
    phase === "countdown"
      ? `Recording in ${countdown}…`
      : phase === "recording"
        ? "Recording…"
        : phase === "encoding"
          ? "Making GIF…"
          : phase === "error"
            ? "Try camera again"
            : "Record GIF";

  return (
    <main
      className="page recorder-page"
      data-recording={
        phase === "countdown" || phase === "recording" || phase === "encoding"
      }
    >
      <h1>gif urself</h1>
      <p className="intro">Record GIFs. Save them here if you want.</p>
      <div
        className="capture-frame"
        data-camera-ready={phase !== "starting" && phase !== "error"}
        data-outline={
          !pending &&
          (phase === "starting" || phase === "ready" || phase === "error")
        }
      >
        {pending && gifUrl ? (
          <img src={gifUrl} alt="Your recorded GIF" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="Live camera preview"
          />
        )}
        {phase === "countdown" && !pending && (
          <div className="camera-overlay">{countdown}</div>
        )}
        {phase === "encoding" && !pending && (
          <div className="camera-overlay small">Making GIF…</div>
        )}
        {savingGif && <div className="camera-overlay small">Saving GIF…</div>}
        {(saveError || (message && !pending)) && !savingGif && (
          <div className="camera-overlay small" role="alert">
            {saveError || message}
          </div>
        )}
        {phase === "countdown" && !pending && (
          <div className="countdown-border" aria-hidden="true" />
        )}
      </div>
      <canvas ref={canvasRef} width="400" height="300" hidden />
      <p className="sr-only" role="status">
        {pending
          ? savingGif
            ? "Saving GIF"
            : "GIF ready"
          : phase === "ready"
            ? "Ready to record"
            : phase === "starting"
              ? "Starting camera"
              : phase === "error"
                ? ""
                : recordLabel}
      </p>
      {pendingWarning && (
        <p className="notice warning" role="alert">
          {pendingWarning}
        </p>
      )}
      {pending && gifUrl ? (
        <div className="recorder-actions">
          <div className="action-pair">
            <Button
              className="button secondary"
              onPress={() => void startOver()}
            >
              Start over
            </Button>
            <a
              className="button secondary"
              href={gifUrl}
              download="gif-urself.gif"
            >
              Download
            </a>
          </div>
          <Button
            className="button primary"
            isDisabled={savingGif}
            onPress={() => void saveGif()}
          >
            {savingGif ? "Saving…" : "Save GIF"}
          </Button>
        </div>
      ) : (
        <div className="recorder-actions">
          <Button
            className="button primary record-button"
            data-timing={phase === "recording" || phase === "encoding"}
            isDisabled={
              phase === "starting" ||
              phase === "countdown" ||
              phase === "recording" ||
              phase === "encoding"
            }
            onPress={
              phase === "error" ? () => window.location.reload() : record
            }
          >
            {(phase === "recording" || phase === "encoding") && (
              <span
                className="record-progress"
                role="progressbar"
                aria-label="Recording progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                style={{ width: `${progress * 100}%` }}
              />
            )}
            <span className="record-button-label">{recordLabel}</span>
          </Button>
        </div>
      )}
      <p className="recorder-note">
        {user ? (
          <Link to="/gifs">Saved GIFs</Link>
        ) : signInConfigured ? (
          <a href="/api/auth/login?next=%2Fgifs">Sign in to see saved GIFs</a>
        ) : (
          <Link to="/signin">Sign in to see saved GIFs</Link>
        )}
      </p>
    </main>
  );
}
