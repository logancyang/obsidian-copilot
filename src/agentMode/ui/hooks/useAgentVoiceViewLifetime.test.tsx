import { useAgentVoiceViewLifetime } from "@/agentMode/ui/hooks/useAgentVoiceViewLifetime";
import type { AgentVoiceControls } from "@/agentMode/session/voiceTypes";
import { renderHook } from "@testing-library/react";

describe("useAgentVoiceViewLifetime", () => {
  describe("useAgentVoiceViewLifetime()", () => {
    it("keeps voice through rerenders and ends when its owning view unmounts", () => {
      const controls = {
        end: jest.fn().mockResolvedValue(undefined),
      } as unknown as AgentVoiceControls;
      const view = renderHook(() => useAgentVoiceViewLifetime(controls, window));
      view.rerender();
      expect(controls.end).not.toHaveBeenCalled();
      view.unmount();
      expect(controls.end).toHaveBeenCalledTimes(1);
    });
    it("ends voice when the owning window closes and removes the window listener", () => {
      const controls = {
        end: jest.fn().mockResolvedValue(undefined),
      } as unknown as AgentVoiceControls;
      const view = renderHook(() => useAgentVoiceViewLifetime(controls, window));
      window.dispatchEvent(new Event("pagehide"));
      expect(controls.end).toHaveBeenCalledTimes(1);
      view.unmount();
      window.dispatchEvent(new Event("pagehide"));
      expect(controls.end).toHaveBeenCalledTimes(1);
    });
    it("ends the old call before binding a new conversation owner", () => {
      const first = {
        end: jest.fn().mockResolvedValue(undefined),
      } as unknown as AgentVoiceControls;
      const second = {
        end: jest.fn().mockResolvedValue(undefined),
      } as unknown as AgentVoiceControls;
      const view = renderHook(({ controls }) => useAgentVoiceViewLifetime(controls, window), {
        initialProps: { controls: first },
      });
      view.rerender({ controls: second });
      expect(first.end).toHaveBeenCalledTimes(1);
      expect(second.end).not.toHaveBeenCalled();
      view.unmount();
      expect(second.end).toHaveBeenCalledTimes(1);
    });
  });
});
