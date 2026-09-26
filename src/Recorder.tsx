import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "./AppContext";
import {
  addFrame,
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
  const { user, pending, pendingWarning, savePending, discardPending } =
    useApp();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);
  const active = useRef(true);
  const [phase, setPhase] = useState<Phase>("starting");
  const [countdown, setCountdown] = useState(3);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [gifUrl, setGifUrl] = useState("");

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
        if (!active.current) {
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
        if (active.current) {
          setPhase("error");
          setMessage("Camera unavailable. Allow camera access and try again.");
        }
      }
    }
    void startCamera();
    return () => {
      active.current = false;
      timers.current.forEach(window.clearInterval);
      timers.current = [];
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [pending]);

  function record() {
    if (phase !== "ready") return;
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
    try {
      const encoder = createEncoder();
      let frame = 0;
      const capture = () => {
        if (!active.current) return;
        addFrame(encoder, context, video, frame);
        frame += 1;
        setProgress(frame / FRAME_COUNT);
        if (frame >= FRAME_COUNT) {
          window.clearInterval(recordingTimer);
          setPhase("encoding");
          window.setTimeout(() => {
            try {
              const blob = finishEncoder(encoder);
              if (active.current) void savePending(blob);
            } catch {
              if (active.current) {
                setPhase("ready");
                setMessage("Could not make this GIF. Try recording again.");
              }
            }
          }, 0);
        }
      };
      capture();
      const recordingTimer = window.setInterval(
        capture,
        DURATION_MS / FRAME_COUNT,
      );
      timers.current.push(recordingTimer);
    } catch {
      setPhase("error");
      setMessage("Could not start the GIF encoder. Reload and try again.");
    }
  }

  async function startOver() {
    await discardPending();
    setProgress(0);
    setMessage("");
  }

  const status = pending
    ? "Your GIF is ready. Download it or save it to your library."
    : phase === "starting"
      ? "Starting camera…"
      : phase === "ready"
        ? "Camera ready"
        : phase === "countdown"
          ? `Recording in ${countdown}…`
          : phase === "recording"
            ? "Recording…"
            : phase === "encoding"
              ? "Making your GIF…"
              : message;

  return (
    <main className="page recorder-page">
      <div className="page-kicker">A tiny reaction GIF machine</div>
      <h1>gif urself</h1>
      <p className="intro">Three seconds. Your face. Your reaction.</p>
      <div className="capture-frame">
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
        {phase === "error" && !pending && (
          <div className="camera-overlay small">Camera unavailable</div>
        )}
        {phase === "recording" && (
          <div
            className="recording-progress"
            style={{ width: `${progress * 100}%` }}
          />
        )}
      </div>
      <canvas ref={canvasRef} width="400" height="300" hidden />
      <p className="status-line" role="status">
        {status}
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
            onPress={() => navigate(user ? "/save" : "/signin?next=%2Fsave")}
          >
            Save GIF
          </Button>
        </div>
      ) : (
        <div className="recorder-actions">
          <Button
            className="button primary"
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
            {phase === "error"
              ? "Try camera again"
              : phase === "ready"
                ? "Record GIF"
                : status}
          </Button>
          <p className="subtle">No account needed to record or download.</p>
        </div>
      )}
      <p className="recorder-note">
        Saved GIFs can be shared with your private groups.{" "}
        <Link to="/groups">See groups</Link>
      </p>
    </main>
  );
}
