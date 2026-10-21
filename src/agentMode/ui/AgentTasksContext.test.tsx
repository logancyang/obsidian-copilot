import { AgentTasksProvider, useAgentTasks } from "@/agentMode/ui/AgentTasksContext";
import { makeTask } from "@/agentMode/ui/testing/taskFixtures";
import { renderHook } from "@testing-library/react";
import React from "react";

describe("AgentTasksContext", () => {
  describe("useAgentTasks()", () => {
    it("returns no tasks outside a chat that provides them, so trails render as before", () => {
      const { result } = renderHook(() => useAgentTasks());

      expect(result.current).toBeNull();
    });
  });

  describe("AgentTasksProvider", () => {
    it("hands its chat's tasks and task opener to the trail, keeping the value stable across renders", () => {
      const tasks = [makeTask()];
      const openTask = jest.fn();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AgentTasksProvider tasks={tasks} openTask={openTask}>
          {children}
        </AgentTasksProvider>
      );
      const { result, rerender } = renderHook(() => useAgentTasks(), { wrapper });
      const first = result.current;

      rerender();

      expect(first).toEqual({ tasks, openTask });
      expect(result.current).toBe(first);
    });
  });
});
