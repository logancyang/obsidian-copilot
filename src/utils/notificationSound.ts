import { logWarn } from "@/logger";

/**
 * A4. Low enough to sit comfortably under whatever the user is doing, high
 * enough to carry across a room; a decaying tone here reads as a struck key
 * rather than an alarm.
 */
const TONE_HZ = 440;
/** Whole strike, decay tail included. */
const TONE_SECONDS = 0.6;
/** Deliberately quiet: this fires while the user is doing something else. */
const PEAK_GAIN = 0.15;
/** Exponential ramps cannot reach zero, so decay to an inaudible floor. */
const SILENCE_GAIN = 0.0001;
/** Near-instant, so the tone is struck rather than swelled. */
const ATTACK_SECONDS = 0.005;

/**
 * One context for the plugin's lifetime. Each context owns an OS audio
 * thread, so creating one per chime would spend a thread and its startup
 * latency on every play.
 */
let context: AudioContext | null = null;

/**
 * Play a single short tone to tell the user something wants their attention.
 *
 * Synthesized rather than loaded from an audio file: an Obsidian plugin ships
 * only `main.js`, `styles.css`, and `manifest.json`, so a sound file would
 * have to ride along base64-encoded inside the bundle.
 *
 * Best-effort by design — it never throws and does nothing on a runtime with
 * no Web Audio, because failing to make a sound must not fail the turn that
 * asked for one.
 */
export function playNotificationSound(): void {
  try {
    if (!context) {
      if (!window.AudioContext) return;
      context = new window.AudioContext();
    }
    // Chromium suspends a context constructed before any user gesture. By the
    // time an agent turn ends the user has typed and sent a message, so the
    // resume succeeds; it is a no-op on an already-running context.
    if (context.state === "suspended") void context.resume();

    const startAt = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(TONE_HZ, startAt);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, startAt);
    envelope.gain.linearRampToValueAtTime(PEAK_GAIN, startAt + ATTACK_SECONDS);
    envelope.gain.exponentialRampToValueAtTime(SILENCE_GAIN, startAt + TONE_SECONDS);

    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(startAt);
    // Web Audio source nodes are single-use; the scheduled stop is what
    // releases this one instead of leaving it running silently forever.
    oscillator.stop(startAt + TONE_SECONDS);
  } catch (error) {
    logWarn("Copilot: failed to play the notification sound.", error);
  }
}

/**
 * Release the shared audio context. Called at plugin unload: a disabled
 * plugin can never reclaim the audio thread its context holds, and the next
 * `playNotificationSound` builds a fresh one.
 */
export function disposeNotificationSound(): void {
  const closing = context;
  context = null;
  closing?.close().catch((error) => {
    logWarn("Copilot: failed to close the notification audio context.", error);
  });
}
