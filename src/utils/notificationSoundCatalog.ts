interface Strike {
  readonly hz: readonly number[];
  readonly at: number;
  readonly seconds: number;
}

export interface NotificationSoundSpec {
  readonly label: string;
  readonly wave: OscillatorType;
  readonly peakGain: number;
  readonly strikes: readonly Strike[];
}

export const NOTIFICATION_SOUNDS = {
  piano: {
    label: "Piano key",
    wave: "triangle",
    peakGain: 0.15,
    strikes: [{ hz: [440], at: 0, seconds: 0.6 }],
  },
  marimba: {
    label: "Marimba",
    wave: "sine",
    peakGain: 0.18,
    strikes: [{ hz: [587.33], at: 0, seconds: 0.32 }],
  },
  bell: {
    label: "Bell",
    wave: "sine",
    peakGain: 0.12,
    strikes: [{ hz: [659.25, 987.77], at: 0, seconds: 1.4 }],
  },
  doorbell: {
    label: "Doorbell",
    wave: "sine",
    peakGain: 0.16,
    strikes: [
      { hz: [659.25], at: 0, seconds: 0.5 },
      { hz: [523.25], at: 0.18, seconds: 0.6 },
    ],
  },
} as const satisfies Record<string, NotificationSoundSpec>;

export type NotificationSoundId = keyof typeof NOTIFICATION_SOUNDS;

export const DEFAULT_NOTIFICATION_SOUND_ID: NotificationSoundId = "piano";

export const NOTIFICATION_SOUND_OPTIONS: ReadonlyArray<{ label: string; value: string }> =
  Object.freeze(
    Object.entries(NOTIFICATION_SOUNDS).map(([value, spec]) => ({ label: spec.label, value }))
  );

export function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  // Persisted ids are untrusted: Object.prototype names must not resolve as sounds.
  // https://github.com/logancyang/obsidian-copilot/issues/2987
  return (
    typeof value === "string" &&
    Boolean(Object.prototype.hasOwnProperty.call(NOTIFICATION_SOUNDS, value))
  );
}
