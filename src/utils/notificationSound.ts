import { logWarn } from "@/logger";
import {
  DEFAULT_NOTIFICATION_SOUND_ID,
  NOTIFICATION_SOUNDS,
  type NotificationSoundId,
  type NotificationSoundSpec,
} from "@/utils/notificationSoundCatalog";

/** Near-instant, so every sound is struck rather than swelled. */
const ATTACK_SECONDS = 0.005;
/** Exponential ramps cannot reach zero, so decay to an inaudible floor. */
const SILENCE_GAIN = 0.0001;
/** Prevent clustered agent events from producing an audio burst. */
const SOUND_GRACE_PERIOD_MS = 1_000;

/**
 * One context for the plugin's lifetime. Each context owns an OS audio
 * thread, so creating one per sound would spend a thread and its startup
 * latency on every play.
 */
let context: AudioContext | null = null;
let lastPlayedAtMs: number | undefined;

/**
 * Play the named sound to tell the user something wants their attention.
 *
 * Synthesized rather than loaded from audio files: an Obsidian plugin ships
 * only `main.js`, `styles.css`, and `manifest.json`, so every sound would have
 * to ride along base64-encoded inside the bundle.
 *
 * Best-effort by design — it never throws and does nothing on a runtime with
 * no Web Audio, because failing to make a sound must not fail the turn that
 * asked for one.
 *
 * @param id which catalog sound to play; an id no longer in the catalog falls
 *   back to the default rather than leaving the user with silence.
 */
export function playNotificationSound(id: NotificationSoundId): void {
  try {
    const nowMs = Date.now();
    // https://github.com/logancyang/obsidian-copilot/issues/2987
    if (lastPlayedAtMs !== undefined && nowMs - lastPlayedAtMs < SOUND_GRACE_PERIOD_MS) return;
    if (!context) {
      if (!window.AudioContext) return;
      context = new window.AudioContext();
    }
    lastPlayedAtMs = nowMs;
    // Chromium suspends a context constructed before any user gesture. By the
    // time an agent turn ends the user has typed and sent a message, so the
    // resume succeeds; it is a no-op on an already-running context.
    if (context.state === "suspended") void context.resume();

    const spec: NotificationSoundSpec =
      NOTIFICATION_SOUNDS[id] ?? NOTIFICATION_SOUNDS[DEFAULT_NOTIFICATION_SOUND_ID];
    const now = context.currentTime;
    for (const strike of spec.strikes) {
      // Split the peak across the strike's frequencies, so a two-frequency
      // strike is not twice as loud as a one-frequency one.
      const peak = spec.peakGain / strike.hz.length;
      for (const hz of strike.hz) {
        const startAt = now + strike.at;
        const oscillator = context.createOscillator();
        oscillator.type = spec.wave;
        oscillator.frequency.setValueAtTime(hz, startAt);

        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0, startAt);
        envelope.gain.linearRampToValueAtTime(peak, startAt + ATTACK_SECONDS);
        envelope.gain.exponentialRampToValueAtTime(SILENCE_GAIN, startAt + strike.seconds);

        oscillator.connect(envelope);
        envelope.connect(context.destination);
        oscillator.start(startAt);
        // Web Audio source nodes are single-use; the scheduled stop is what
        // releases this one instead of leaving it running silently forever.
        oscillator.stop(startAt + strike.seconds);
      }
    }
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
  lastPlayedAtMs = undefined;
  closing?.close().catch((error) => {
    logWarn("Copilot: failed to close the notification audio context.", error);
  });
}
