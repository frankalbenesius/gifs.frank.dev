interface GifEncoder {
  setRepeat(count: number): void;
  start(): void;
  setDelay(milliseconds: number): void;
  addFrame(context: CanvasRenderingContext2D): void;
  finish(): void;
  stream(): { getData(): string };
}

declare const GIFEncoder: new () => GifEncoder;

export const DURATION_MS = 3000;
export const FRAME_COUNT = 45;

export function createEncoder(): GifEncoder {
  const encoder = new GIFEncoder();
  encoder.setRepeat(0);
  encoder.start();
  return encoder;
}

export function addFrame(
  encoder: GifEncoder,
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  index: number,
): void {
  const sourceRatio = video.videoWidth / video.videoHeight;
  const targetRatio = context.canvas.width / context.canvas.height;
  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;
  if (sourceRatio > targetRatio) {
    sw = sh * targetRatio;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = sw / targetRatio;
    sy = (video.videoHeight - sh) / 2;
  }
  context.drawImage(
    video,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    context.canvas.width,
    context.canvas.height,
  );
  const next = Math.round(((index + 1) * DURATION_MS) / FRAME_COUNT / 10);
  const current = Math.round((index * DURATION_MS) / FRAME_COUNT / 10);
  encoder.setDelay((next - current) * 10);
  encoder.addFrame(context);
}

export function finishEncoder(encoder: GifEncoder): Blob {
  encoder.finish();
  const binary = encoder.stream().getData();
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "image/gif" });
}
