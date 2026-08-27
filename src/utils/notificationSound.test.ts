import { disposeNotificationSound, playNotificationSound } from "@/utils/notificationSound";
import {
  DEFAULT_NOTIFICATION_SOUND_ID,
  NOTIFICATION_SOUNDS,
  type NotificationSoundId,
} from "@/utils/notificationSoundCatalog";
import { logWarn } from "@/logger";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

interface MockAudio {
  constructorCalls: number;
  instance: {
    state: AudioContextState;
    currentTime: number;
    destination: unknown;
    resume: jest.Mock;
    close: jest.Mock;
    createOscillator: jest.Mock;
    createGain: jest.Mock;
  };
  oscillator: {
    type: string;
    frequency: { setValueAtTime: jest.Mock };
    connect: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
  };
  gain: {
    gain: {
      setValueAtTime: jest.Mock;
      linearRampToValueAtTime: jest.Mock;
      exponentialRampToValueAtTime: jest.Mock;
    };
    connect: jest.Mock;
  };
}

/** jsdom has no Web Audio, so every test supplies its own. */
function installMockAudio(state: AudioContextState = "running"): MockAudio {
  const oscillator: MockAudio["oscillator"] = {
    type: "sine",
    frequency: { setValueAtTime: jest.fn() },
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  };
  const gain: MockAudio["gain"] = {
    gain: {
      setValueAtTime: jest.fn(),
      linearRampToValueAtTime: jest.fn(),
      exponentialRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
  };
  const instance: MockAudio["instance"] = {
    state,
    currentTime: 0,
    destination: { id: "destination" },
    resume: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    createOscillator: jest.fn(() => oscillator),
    createGain: jest.fn(() => gain),
  };
  const mock: MockAudio = { constructorCalls: 0, instance, oscillator, gain };
  window.AudioContext = jest.fn(() => {
    mock.constructorCalls += 1;
    return instance;
  }) as unknown as typeof AudioContext;
  return mock;
}

describe("notificationSound", () => {
  beforeEach(() => {
    (logWarn as jest.Mock).mockClear();
  });

  afterEach(() => {
    // Also drops the module-level context so the next test starts cold.
    disposeNotificationSound();
    jest.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).AudioContext;
  });

  describe("playNotificationSound()", () => {
    it("plays one enveloped tone that starts immediately and stops on its own", () => {
      const audio = installMockAudio();

      playNotificationSound("piano");

      expect(audio.oscillator.type).toBe("triangle");
      expect(audio.oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(440, 0);
      expect(audio.gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
      expect(audio.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.15, 0.005);
      expect(audio.gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 0.6);
      expect(audio.oscillator.connect).toHaveBeenCalledWith(audio.gain);
      expect(audio.gain.connect).toHaveBeenCalledWith(audio.instance.destination);
      expect(audio.oscillator.start).toHaveBeenCalledWith(0);
      expect(audio.oscillator.stop).toHaveBeenCalledWith(0.6);
    });

    it("sounds every frequency of a strike together, splitting the peak between them", () => {
      const audio = installMockAudio();

      playNotificationSound("bell");

      // Two frequencies, one strike: both start at 0, both take half the peak.
      expect(audio.instance.createOscillator).toHaveBeenCalledTimes(2);
      expect(audio.oscillator.frequency.setValueAtTime.mock.calls).toEqual([
        [659.25, 0],
        [987.77, 0],
      ]);
      expect(audio.gain.gain.linearRampToValueAtTime.mock.calls).toEqual([
        [0.06, 0.005],
        [0.06, 0.005],
      ]);
    });

    it("delays a second strike so a two-tone sound reads as two notes", () => {
      const audio = installMockAudio();

      playNotificationSound("doorbell");

      expect(audio.oscillator.frequency.setValueAtTime.mock.calls).toEqual([
        [659.25, 0],
        [523.25, 0.18],
      ]);
      expect(audio.oscillator.stop.mock.calls).toEqual([[0.5], [0.78]]);
    });

    it("falls back to the default sound when the stored id is no longer in the catalog", () => {
      const audio = installMockAudio();

      playNotificationSound("removed-sound" as NotificationSoundId);

      expect(audio.oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(
        NOTIFICATION_SOUNDS[DEFAULT_NOTIFICATION_SOUND_ID].strikes[0].hz[0],
        0
      );
    });

    it("reuses one audio context across plays outside the grace period", () => {
      const audio = installMockAudio();
      jest.spyOn(window.performance, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

      playNotificationSound("piano");
      playNotificationSound("piano");

      expect(audio.constructorCalls).toBe(1);
      expect(audio.instance.createOscillator).toHaveBeenCalledTimes(2);
    });

    it("allows at most one sound per second (https://github.com/logancyang/obsidian-copilot/issues/2987)", () => {
      const audio = installMockAudio();
      jest
        .spyOn(window.performance, "now")
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(1_999)
        .mockReturnValueOnce(2_000);

      playNotificationSound("piano");
      playNotificationSound("piano");
      playNotificationSound("piano");

      expect(audio.instance.createOscillator).toHaveBeenCalledTimes(2);
    });

    it("still plays after one monotonic second when the wall clock moves backward (https://github.com/logancyang/obsidian-copilot/issues/2987)", () => {
      const audio = installMockAudio();
      jest.spyOn(Date, "now").mockReturnValueOnce(2_000).mockReturnValueOnce(1_000);
      jest.spyOn(window.performance, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

      playNotificationSound("piano");
      playNotificationSound("piano");

      expect(audio.instance.createOscillator).toHaveBeenCalledTimes(2);
    });

    it("resumes a suspended context so the tone is audible", () => {
      const audio = installMockAudio("suspended");

      playNotificationSound("piano");

      expect(audio.instance.resume).toHaveBeenCalled();
    });

    it("logs and absorbs a rejected context resume (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
      const audio = installMockAudio("suspended");
      const error = new Error("playback blocked");
      audio.instance.resume.mockRejectedValue(error);

      playNotificationSound("piano");
      await Promise.resolve();

      expect(logWarn).toHaveBeenCalledWith("Copilot: failed to resume notification audio.", error);
    });

    it("does nothing when the runtime exposes no Web Audio (https://github.com/logancyang/obsidian-copilot/issues/2987)", () => {
      delete (window as unknown as Record<string, unknown>).AudioContext;

      expect(() => playNotificationSound("piano")).not.toThrow();
    });

    it("swallows a failure from the audio stack", () => {
      const audio = installMockAudio();
      audio.instance.createOscillator.mockImplementation(() => {
        throw new Error("no audio device");
      });

      expect(() => playNotificationSound("piano")).not.toThrow();
    });
  });

  describe("disposeNotificationSound()", () => {
    it("closes the open context and builds a fresh one for the next play", () => {
      const audio = installMockAudio();
      playNotificationSound("piano");

      disposeNotificationSound();
      playNotificationSound("piano");

      expect(audio.instance.close).toHaveBeenCalledTimes(1);
      expect(audio.constructorCalls).toBe(2);
    });

    it("is a no-op when no sound has ever played", () => {
      const audio = installMockAudio();

      disposeNotificationSound();

      expect(audio.instance.close).not.toHaveBeenCalled();
    });
  });
});
