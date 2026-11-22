import { logWarn } from "@/logger";
import {
  DEFAULT_NOTIFICATION_SOUND_ID,
  NOTIFICATION_SOUNDS,
  type NotificationSoundId,
  type NotificationSoundSpec,
} from "@/utils/notificationSoundCatalog";

const ATTACK_SECONDS = 0.005;
const SILENCE_GAIN = 0.0001;
const SOUND_GRACE_PERIOD_MS = 1_000;

let context: AudioContext | null = null;
let lastPlayedAtMs: number | undefined;

export function playNotificationSound(id: NotificationSoundId): void {
  try {
    const nowMs = window.performance.now();
    if (lastPlayedAtMs !== undefined && nowMs - lastPlayedAtMs < SOUND_GRACE_PERIOD_MS) return;
    if (!context) {
      // A runtime without Web Audio must not interrupt the agent event.
      // https://github.com/logancyang/obsidian-copilot/issues/2987
      if (!window.AudioContext) return;
      context = new window.AudioContext();
    }
    lastPlayedAtMs = nowMs;
    if (context.state === "suspended") {
      // Autoplay policy can reject asynchronously, outside the synchronous guard.
      // https://github.com/logancyang/obsidian-copilot/issues/2987
      void context
        .resume()
        .catch((error) => logWarn("Copilot: failed to resume notification audio.", error));
    }

    const spec: NotificationSoundSpec =
      NOTIFICATION_SOUNDS[id] ?? NOTIFICATION_SOUNDS[DEFAULT_NOTIFICATION_SOUND_ID];
    const now = context.currentTime;
    for (const strike of spec.strikes) {
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
        oscillator.stop(startAt + strike.seconds);
      }
    }
  } catch (error) {
    logWarn("Copilot: failed to play the notification sound.", error);
  }
}

export function disposeNotificationSound(): void {
  const closing = context;
  context = null;
  lastPlayedAtMs = undefined;
  closing?.close().catch((error) => {
    logWarn("Copilot: failed to close the notification audio context.", error);
  });
}
