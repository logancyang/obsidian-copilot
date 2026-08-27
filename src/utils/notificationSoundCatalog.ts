/**
 * The notification sounds the user can choose between, as pure data.
 *
 * Separate from the player because `@/settings/model` has to validate a
 * persisted sound id, and the player reaches `@/logger`, which reaches back
 * into `@/settings/model`. Keeping the catalog free of that import keeps the
 * settings module out of an import cycle.
 */
/** One moment of sound: every frequency in `hz` is sounded together. */
interface Strike {
  /** Frequencies sounded at once. More than one gives the strike its timbre. */
  readonly hz: readonly number[];
  /** Seconds after the sound begins. A second strike is what makes a two-tone. */
  readonly at: number;
  /** Seconds from attack to inaudible. Short reads as wooden, long as ringing. */
  readonly seconds: number;
}

/**
 * A named sound the user can pick. Everything audible about it lives here as
 * data, so adding a sound means adding an entry rather than a code path.
 */
export interface NotificationSoundSpec {
  /** Shown in the settings picker; names what it sounds like. */
  readonly label: string;
  readonly wave: OscillatorType;
  /** Loudness of one strike, split across its frequencies. */
  readonly peakGain: number;
  readonly strikes: readonly Strike[];
}

/**
 * The sounds offered in Basic → Agents. Frequencies are named pitches: a
 * decaying tone near A4/D5 reads as an instrument being struck, while the
 * higher pair and the longer tail are what make the bell ring.
 */
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

/** Options for the settings picker, in catalog order. */
export const NOTIFICATION_SOUND_OPTIONS: ReadonlyArray<{ label: string; value: string }> =
  Object.freeze(
    Object.entries(NOTIFICATION_SOUNDS).map(([value, spec]) => ({ label: spec.label, value }))
  );

/** Whether a persisted or user-supplied value names a sound that still exists. */
export function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  // Persisted ids are untrusted: Object.prototype names must not resolve as
  // sounds and reach the player as malformed specs.
  // https://github.com/logancyang/obsidian-copilot/issues/2987
  return (
    typeof value === "string" &&
    Boolean(Object.prototype.hasOwnProperty.call(NOTIFICATION_SOUNDS, value))
  );
}
