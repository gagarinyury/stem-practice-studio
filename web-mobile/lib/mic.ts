/**
 * Mic permission + stream cache. We disable echoCancellation / noiseSuppression
 * so pitch detection sees the raw signal — those filters skew low-freq voice
 * detection.
 */

let cached: Promise<MediaStream> | null = null;

export async function requestMic(): Promise<MediaStream> {
  if (cached) return cached;
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("microphone unavailable");
  }
  cached = navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  try {
    return await cached;
  } catch (err) {
    cached = null;
    throw err;
  }
}

export function releaseMic(): void {
  if (!cached) return;
  cached.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
  cached = null;
}

export function micGranted(): boolean {
  return cached !== null;
}
