import { VoiceModeBar } from "@/agentMode/ui/VoiceModeBar";
import { VOICE_OFF_RUNTIME_STATE } from "@/agentMode/session/voiceTypes";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("VoiceModeBar", () => {
  describe("VoiceModeBar()", () => {
    it("keeps a one-time deadline warning truthful as elapsed time advances", () => {
      render(
        <VoiceModeBar
          state={{ ...VOICE_OFF_RUNTIME_STATE, session: "active", secondsRemainingWarning: 60 }}
          elapsedSeconds={565}
          onMutedChange={jest.fn()}
          onEnd={jest.fn()}
        />
      );
      expect(screen.getByText("Voice ends within a minute.")).toBeTruthy();
    });
    it("keeps microphone and End voice controls available while the assistant speaks", () => {
      const onMutedChange = jest.fn();
      const onEnd = jest.fn();
      render(
        <VoiceModeBar
          state={{ ...VOICE_OFF_RUNTIME_STATE, session: "active", playbackActive: true }}
          elapsedSeconds={84}
          onMutedChange={onMutedChange}
          onEnd={onEnd}
        />
      );
      expect(screen.getByText("01:24")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
      fireEvent.click(screen.getByRole("button", { name: "End voice" }));
      expect(onMutedChange).toHaveBeenCalledWith(true);
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
    it("labels connection setup and permits ending before connection completes", () => {
      render(
        <VoiceModeBar
          state={{ ...VOICE_OFF_RUNTIME_STATE, session: "connecting" }}
          elapsedSeconds={0}
          onMutedChange={jest.fn()}
          onEnd={jest.fn()}
        />
      );
      expect(screen.getByText("Connecting voice…")).toBeTruthy();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Mute microphone" }).disabled
      ).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "End voice" }).disabled).toBe(
        false
      );
    });
    it("explains queued follow-ups and keeps silence independent from local task completion", () => {
      render(
        <VoiceModeBar
          state={{
            ...VOICE_OFF_RUNTIME_STATE,
            session: "active",
            inputMuted: true,
            queuedFollowUps: ["Focus on customer feedback"],
          }}
          elapsedSeconds={0}
          onMutedChange={jest.fn()}
          onEnd={jest.fn()}
        />
      );
      expect(screen.getByRole("button", { name: "Unmute microphone" })).toBeTruthy();
      expect(screen.getByText(/has not changed the running task/)).toBeTruthy();
      expect(screen.getByRole("img", { name: "Assistant audio quiet" })).toBeTruthy();
    });
  });
});
