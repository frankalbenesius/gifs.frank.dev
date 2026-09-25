const DURATION_MS = 3000;
const FRAME_COUNT = 45;
const FRAME_DELAY_MS = DURATION_MS / FRAME_COUNT;

const camera = document.querySelector("#camera");
const result = document.querySelector("#result");
const overlay = document.querySelector("#overlay");
const progress = document.querySelector("#progress");
const progressFill = document.querySelector("#progress-fill");
const recordButton = document.querySelector("#record");
const recordLabel = document.querySelector("#record-label");
const download = document.querySelector("#download");
const status = document.querySelector("#status");
const canvas = document.querySelector("#capture");
const context = canvas.getContext("2d", { willReadFrequently: true });

let phase = "loading";
let gifUrl = null;

async function startCamera() {
  phase = "loading";
  recordButton.disabled = true;
  recordLabel.textContent = "starting camera…";
  status.textContent = "Starting camera";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    camera.srcObject = stream;
    await camera.play();
    phase = "ready";
    recordButton.disabled = false;
    recordLabel.textContent = "record gif";
    status.textContent = "Camera ready";
  } catch (error) {
    phase = "error";
    recordButton.disabled = false;
    recordLabel.textContent = "try camera again";
    overlay.textContent = "camera unavailable";
    overlay.classList.add("processing");
    overlay.hidden = false;
    status.textContent = "Camera unavailable. Allow camera access and try again.";
    console.error("Could not start camera", error);
  }
}

function setProgress(fraction) {
  const percent = Math.round(Math.min(1, fraction) * 100);
  progressFill.style.width = `${percent}%`;
  progress.setAttribute("aria-valuenow", String(percent));
}

function startCountdown() {
  if (phase !== "ready") return;

  phase = "countdown";
  recordButton.disabled = true;
  recordLabel.textContent = "get ready…";
  download.hidden = true;
  result.hidden = true;
  camera.hidden = false;
  progress.hidden = true;
  overlay.classList.remove("processing");
  overlay.hidden = false;

  const countdownEnd = performance.now() + DURATION_MS;
  let lastNumber = 0;

  function tick(now) {
    const remaining = Math.ceil((countdownEnd - now) / 1000);
    if (remaining <= 0) {
      startRecording();
      return;
    }
    if (remaining !== lastNumber) {
      overlay.textContent = String(remaining);
      status.textContent = `Recording starts in ${remaining}`;
      lastNumber = remaining;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function startRecording() {
  phase = "recording";
  recordButton.classList.add("is-recording");
  overlay.hidden = true;
  progress.hidden = false;
  setProgress(0);
  recordLabel.textContent = "recording…";
  status.textContent = "Recording GIF";

  const encoder = new GIFEncoder();
  encoder.setRepeat(0);
  encoder.start();

  let frames = 0;
  function captureFrame() {
    if (frames >= FRAME_COUNT) return;
    context.drawImage(camera, 0, 0, canvas.width, canvas.height);
    const nextCentisecond = Math.round(((frames + 1) * DURATION_MS) / FRAME_COUNT / 10);
    const currentCentisecond = Math.round((frames * DURATION_MS) / FRAME_COUNT / 10);
    encoder.setDelay((nextCentisecond - currentCentisecond) * 10);
    encoder.addFrame(context);
    frames += 1;
  }

  const startedAt = performance.now();
  captureFrame();
  const captureInterval = setInterval(captureFrame, FRAME_DELAY_MS);

  function updateProgress(now) {
    if (phase !== "recording") return;
    const fraction = Math.min(1, (now - startedAt) / DURATION_MS);
    setProgress(fraction);
    requestAnimationFrame(updateProgress);
  }
  requestAnimationFrame(updateProgress);

  setTimeout(() => {
    clearInterval(captureInterval);
    phase = "processing";
    recordButton.classList.remove("is-recording");
    setProgress(1);
    overlay.textContent = "making gif…";
    overlay.classList.add("processing");
    overlay.hidden = false;
    recordLabel.textContent = "making gif…";
    status.textContent = "Making GIF";

    // Let the processing state paint before the synchronous GIF encoding finishes.
    requestAnimationFrame(() => setTimeout(() => finishRecording(encoder), 0));
  }, DURATION_MS);
}

function finishRecording(encoder) {
  try {
    encoder.finish();
    const binary = encoder.stream().getData();
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    gifUrl = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
    result.src = gifUrl;
    result.hidden = false;
    camera.hidden = true;
    download.href = gifUrl;
    download.download = timestampedFilename();
    download.hidden = false;
    progress.hidden = true;
    overlay.hidden = true;
    phase = "done";
    recordButton.disabled = false;
    recordLabel.textContent = "start over";
    status.textContent = "GIF ready to download";
  } catch (error) {
    phase = "ready";
    progress.hidden = true;
    overlay.hidden = true;
    recordButton.disabled = false;
    recordLabel.textContent = "record gif";
    status.textContent = "Could not make GIF. Try recording again.";
    console.error("Could not make GIF", error);
  }
}

function timestampedFilename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `gif-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.gif`;
}

function startOver() {
  if (phase !== "done") return;
  phase = "ready";
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  gifUrl = null;
  result.src = "";
  result.hidden = true;
  camera.hidden = false;
  download.hidden = true;
  recordLabel.textContent = "record gif";
  status.textContent = "Camera ready";
}

recordButton.addEventListener("click", () => {
  if (phase === "error") startCamera();
  else if (phase === "done") startOver();
  else startCountdown();
});

window.addEventListener("pagehide", () => {
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  camera.srcObject?.getTracks().forEach((track) => track.stop());
});

startCamera();
