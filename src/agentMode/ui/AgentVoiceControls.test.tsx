import { AgentVoiceControls } from "@/agentMode/ui/AgentVoiceControls";
import {
  VOICE_OFF_RUNTIME_STATE,
  type AgentVoiceControls as Controls,
} from "@/agentMode/session/voiceTypes";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentVoiceControls", () => {
  describe("AgentVoiceControls()", () => {
    const controls: Controls = {
      start: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      setMuted: jest.fn(),
      getState: () => VOICE_OFF_RUNTIME_STATE,
      subscribe: () => () => {},
    };
    beforeEach(() => jest.clearAllMocks());
    it("starts on request and follows connecting and active states in the same conversation", async () => {
      jest.mocked(controls.start).mockResolvedValue({ started: true });
      const view = render(
        <AgentVoiceControls controls={controls} state={VOICE_OFF_RUNTIME_STATE} />
      );
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start voice" })));
      expect(controls.start).toHaveBeenCalledTimes(1);
      view.rerender(
        <AgentVoiceControls
          controls={controls}
          state={{ ...VOICE_OFF_RUNTIME_STATE, session: "connecting" }}
        />
      );
      expect(screen.getByText("Connecting voice…")).toBeTruthy();
      view.rerender(
        <AgentVoiceControls
          controls={controls}
          state={{ ...VOICE_OFF_RUNTIME_STATE, session: "active" }}
        />
      );
      expect(screen.getByText("Voice connected")).toBeTruthy();
      expect(controls.start).toHaveBeenCalledTimes(1);
      expect(controls.end).not.toHaveBeenCalled();
    });
    it("reports a disconnected call and allows restart while voice is off", async () => {
      jest.mocked(controls.start).mockResolvedValue({ started: true });
      render(
        <AgentVoiceControls
          controls={controls}
          state={{ ...VOICE_OFF_RUNTIME_STATE, errorCode: "transport" }}
        />
      );
      expect(screen.getByRole("alert").textContent).toContain("Voice disconnected");
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start voice" })));
      expect(controls.start).toHaveBeenCalledTimes(1);
    });
    it("reports a refused start and leaves typing available", async () => {
      jest
        .mocked(controls.start)
        .mockResolvedValue({ started: false, reason: "Select a single agent first." });
      render(<AgentVoiceControls controls={controls} state={VOICE_OFF_RUNTIME_STATE} />);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start voice" })));
      expect(screen.getByRole("alert").textContent).toBe("Select a single agent first.");
    });
    it("ends the call only on explicit End voice, preserving it across composer remounts", async () => {
      const state = { ...VOICE_OFF_RUNTIME_STATE, session: "active" as const };
      const first = render(<AgentVoiceControls controls={controls} state={state} />);
      first.unmount();
      expect(controls.end).not.toHaveBeenCalled();
      render(<AgentVoiceControls controls={controls} state={state} />);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "End voice" })));
      expect(controls.end).toHaveBeenCalledTimes(1);
    });
    it("updates call time from the owner timestamp and releases its timer on unmount", () => {
      jest.useFakeTimers();
      jest.setSystemTime(100_000);
      const view = render(
        <AgentVoiceControls
          controls={controls}
          state={{ ...VOICE_OFF_RUNTIME_STATE, session: "active", startedAtMs: 90_000 }}
        />
      );
      expect(screen.getByText("00:10")).toBeTruthy();
      act(() => jest.advanceTimersByTime(2000));
      expect(screen.getByText("00:12")).toBeTruthy();
      view.unmount();
      expect(jest.getTimerCount()).toBe(0);
      jest.useRealTimers();
    });
  });
});
