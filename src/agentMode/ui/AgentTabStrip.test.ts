import {
  AgentTabStrip,
  computeVisibleCount,
  partitionSessions,
} from "@/agentMode/ui/AgentTabStrip";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { TooltipProvider } from "@/components/ui/tooltip";
import { refreshLatestVersion } from "@/hooks/useLatestVersion";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

jest.mock("@/hooks/useLatestVersion", () => ({ refreshLatestVersion: jest.fn() }));

describe("AgentTabStrip", () => {
  describe("computeVisibleCount", () => {
    it("returns 0 for empty input", () => {
      expect(computeVisibleCount(500, 0)).toBe(0);
    });

    it("shows all tabs when they fit alongside the + button", () => {
      // 3 fixed tabs + 2 gaps + plus button = 128+4+128+4+128+32 = 424
      expect(computeVisibleCount(424, 3)).toBe(3);
    });

    it("reserves overflow button space when not all tabs fit", () => {
      // With overflow, tab budget is 460 - plus(32) - overflow(32) = 396,
      // which fits 3 fixed tabs and 2 inter-tab gaps.
      expect(computeVisibleCount(460, 5)).toBe(3);
    });

    it("guarantees at least one visible tab even when nothing fits", () => {
      expect(computeVisibleCount(40, 3)).toBe(1);
    });

    it("treats the + button as always reserved", () => {
      // One fixed tab + plus button = 128 + 32.
      expect(computeVisibleCount(160, 1)).toBe(1);
      expect(computeVisibleCount(159, 1)).toBe(1);
    });

    it("accounts for inter-tab gaps", () => {
      // 2 fixed tabs + 1 gap + plus button = 128+4+128+32 = 292.
      expect(computeVisibleCount(292, 2)).toBe(2);
      expect(computeVisibleCount(291, 2)).toBe(1);
    });
  });

  describe("partitionSessions", () => {
    const s = (id: string) => ({ internalId: id });

    it("returns empty arrays for empty input", () => {
      expect(partitionSessions({ sessions: [], visibleCount: 0, activeId: null })).toEqual({
        visibleSessions: [],
        overflowSessions: [],
      });
    });

    it("splits front-to-back when active is already visible", () => {
      const sessions = [s("a"), s("b"), s("c"), s("d")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 2,
        activeId: "a",
      });
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["a", "b"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["c", "d"]);
    });

    it("pins the active tab into the last visible slot when it would overflow", () => {
      const sessions = [s("a"), s("b"), s("c"), s("d")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 2,
        activeId: "d",
      });
      // 'd' takes the last visible slot; 'b' is displaced to the front of overflow.
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["a", "d"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["b", "c"]);
    });

    it("does not swap when activeId is null", () => {
      const sessions = [s("a"), s("b"), s("c")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 1,
        activeId: null,
      });
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["a"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["b", "c"]);
    });

    it("does not swap when active is already visible", () => {
      const sessions = [s("a"), s("b"), s("c")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 2,
        activeId: "b",
      });
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["a", "b"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["c"]);
    });

    it("handles visibleCount === 1 with overflow active", () => {
      const sessions = [s("a"), s("b"), s("c")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 1,
        activeId: "c",
      });
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["c"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["a", "b"]);
    });
  });

  describe("AgentTabStrip()", () => {
    it("preserves tab close without requesting backend release for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
      const session = {
        internalId: "existing",
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => "Existing chat",
        getStatus: () => "idle",
        getNeedsAttention: () => false,
      };
      const manager = {
        subscribe: () => () => {},
        getSessionsForScope: () => [session],
        getActiveProjectId: () => null,
        getActiveSession: () => session,
        getIsStarting: () => false,
        closeSession: jest.fn(async () => {}),
      };
      render(
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(AgentTabStrip, { manager: manager as unknown as AgentSessionManager })
        )
      );
      fireEvent.click(screen.getByRole("button", { name: /Close/ }));
      await waitFor(() => expect(manager.closeSession).toHaveBeenCalledWith("existing"));
    });

    it("refreshes releases after the new-session button creates a tab for https://github.com/Brevilabs/obsidian-copilot-private/issues/317", async () => {
      const session = {
        internalId: "existing",
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => "Existing chat",
        getStatus: () => "idle",
        getNeedsAttention: () => false,
      };
      let finishCreation!: () => void;
      const manager = {
        subscribe: () => () => {},
        getSessionsForScope: () => [session],
        getActiveProjectId: () => null,
        getActiveSession: () => session,
        getIsStarting: () => false,
        createSession: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              finishCreation = resolve;
            })
        ),
      };
      render(
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(AgentTabStrip, { manager: manager as unknown as AgentSessionManager })
        )
      );
      fireEvent.click(screen.getByRole("button", { name: "New agent session" }));
      expect(manager.createSession).toHaveBeenCalledTimes(1);
      expect(refreshLatestVersion).not.toHaveBeenCalled();
      finishCreation();
      await waitFor(() => expect(refreshLatestVersion).toHaveBeenCalledTimes(1));
    });
  });
});
