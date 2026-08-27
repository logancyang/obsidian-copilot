import { disposeNotificationSound, playNotificationSound } from "@/utils/notificationSound";

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
  afterEach(() => {
    // Also drops the module-level context so the next test starts cold.
    disposeNotificationSound();
    delete (window as unknown as Record<string, unknown>).AudioContext;
  });

  describe("playNotificationSound()", () => {
    it("plays one enveloped tone that starts immediately and stops on its own", () => {
      const audio = installMockAudio();

      playNotificationSound();

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

    it("reuses one audio context across repeated plays", () => {
      const audio = installMockAudio();

      playNotificationSound();
      playNotificationSound();

      expect(audio.constructorCalls).toBe(1);
      expect(audio.instance.createOscillator).toHaveBeenCalledTimes(2);
    });

    it("resumes a suspended context so the tone is audible", () => {
      const audio = installMockAudio("suspended");

      playNotificationSound();

      expect(audio.instance.resume).toHaveBeenCalled();
    });

    it("does nothing when the runtime exposes no Web Audio", () => {
      delete (window as unknown as Record<string, unknown>).AudioContext;

      expect(() => playNotificationSound()).not.toThrow();
    });

    it("swallows a failure from the audio stack", () => {
      const audio = installMockAudio();
      audio.instance.createOscillator.mockImplementation(() => {
        throw new Error("no audio device");
      });

      expect(() => playNotificationSound()).not.toThrow();
    });
  });

  describe("disposeNotificationSound()", () => {
    it("closes the open context and builds a fresh one for the next play", () => {
      const audio = installMockAudio();
      playNotificationSound();

      disposeNotificationSound();
      playNotificationSound();

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
