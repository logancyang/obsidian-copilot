import {
  AgentTabStrip,
  computeVisibleCount,
  partitionSessions,
} from "@/agentMode/ui/AgentTabStrip";
import { ClientView } from "@/agentMode/protocol/ClientView";
import { buildBackendSummary, buildTab } from "@/agentMode/protocol/testBuilders";
import {
  AgentPaneCapabilitiesProvider,
  NO_PANE_CAPABILITIES,
} from "@/agentMode/ui/AgentPaneContext";
import { createFixtureClient, type FixtureClientOptions } from "@/agentMode/ui/agentPane.fixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const GLOBAL = "__global__";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
});

function renderStrip(
  options: Partial<FixtureClientOptions> & { onCreated?: () => void; activeId?: string | null } = {}
) {
  const fixture = createFixtureClient({
    sessionId: "a",
    tab: { chatInputId: "in-a", label: "Alpha" },
    host: {
      backends: [buildBackendSummary({ id: "claude", displayName: "Claude Code" })],
      tabs: [
        buildTab({ id: "a", chatInputId: "in-a", label: "Alpha" }),
        buildTab({ id: "b", chatInputId: "in-b", label: null }),
        buildTab({ id: "p", chatInputId: "in-p", label: "Project chat", projectId: "proj" }),
      ],
    },
    ...options,
  });
  const view = new ClientView(GLOBAL);
  view.reconcile(fixture.client.getHost());
  if (options.activeId !== null) view.activate({ id: options.activeId ?? "a", projectId: GLOBAL });
  const utils = render(
    <TooltipProvider>
      <AgentPaneCapabilitiesProvider value={NO_PANE_CAPABILITIES}>
        <AgentTabStrip client={fixture.client} view={view} onCreated={options.onCreated} />
      </AgentPaneCapabilitiesProvider>
    </TooltipProvider>
  );
  return { fixture, view, ...utils };
}

describe("AgentTabStrip", () => {
  describe("computeVisibleCount", () => {
    it("returns 0 for empty input", () => {
      expect(computeVisibleCount(500, 0)).toBe(0);
    });

    it("shows all tabs when they fit alongside the + button", () => {
      expect(computeVisibleCount(424, 3)).toBe(3);
    });

    it("reserves overflow button space when not all tabs fit", () => {
      expect(computeVisibleCount(460, 5)).toBe(3);
    });

    it("guarantees at least one visible tab even when nothing fits", () => {
      expect(computeVisibleCount(40, 3)).toBe(1);
    });

    it("treats the + button as always reserved", () => {
      expect(computeVisibleCount(160, 1)).toBe(1);
      expect(computeVisibleCount(159, 1)).toBe(1);
    });

    it("accounts for inter-tab gaps", () => {
      expect(computeVisibleCount(292, 2)).toBe(2);
      expect(computeVisibleCount(291, 2)).toBe(1);
    });
  });

  describe("partitionSessions", () => {
    const s = (id: string) => ({ id: id });

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
      expect(visibleSessions.map((x) => x.id)).toEqual(["a", "b"]);
      expect(overflowSessions.map((x) => x.id)).toEqual(["c", "d"]);
    });

    it("pins the active tab into the last visible slot when it would overflow", () => {
      const sessions = [s("a"), s("b"), s("c"), s("d")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 2,
        activeId: "d",
      });
      expect(visibleSessions.map((x) => x.id)).toEqual(["a", "d"]);
      expect(overflowSessions.map((x) => x.id)).toEqual(["b", "c"]);
    });

    it("does not swap when activeId is null", () => {
      const sessions = [s("a"), s("b"), s("c")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 1,
        activeId: null,
      });
      expect(visibleSessions.map((x) => x.id)).toEqual(["a"]);
      expect(overflowSessions.map((x) => x.id)).toEqual(["b", "c"]);
    });

    it("does not swap when active is already visible", () => {
      const sessions = [s("a"), s("b"), s("c")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 2,
        activeId: "b",
      });
      expect(visibleSessions.map((x) => x.id)).toEqual(["a", "b"]);
      expect(overflowSessions.map((x) => x.id)).toEqual(["c"]);
    });

    it("handles visibleCount === 1 with overflow active", () => {
      const sessions = [s("a"), s("b"), s("c")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 1,
        activeId: "c",
      });
      expect(visibleSessions.map((x) => x.id)).toEqual(["c"]);
      expect(overflowSessions.map((x) => x.id)).toEqual(["a", "b"]);
    });
  });

  describe("AgentTabStrip()", () => {
    it("shows the tabs of the view's project scope, marking the one the view shows", () => {
      renderStrip();
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent)).toEqual(["Alpha", "Claude Code"]);
      expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    });

    it("shows a project scope's own tabs when the view is in that scope", () => {
      const { view } = renderStrip();
      act(() => view.activate({ id: "p", projectId: "proj" }));
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Project chat"]);
    });

    it("renders nothing when the scope has no tabs", () => {
      const { container } = renderStrip({
        host: { backends: [], tabs: [buildTab({ id: "a", projectId: "proj" })] },
        activeId: null,
      });
      expect(container.querySelector("[role=tablist]")).toBeNull();
    });

    it("shows the clicked tab in this client's view only, sending the host no command https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
      const { fixture, view } = renderStrip();
      fireEvent.click(screen.getAllByRole("tab")[1]);
      expect(view.getActiveTabId()).toBe("b");
      expect(fixture.commands).toEqual([]);
    });

    it("keeps the shown tab when another client adds or closes tabs https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
      const { fixture, view } = renderStrip();
      act(() => {
        fixture.emitHost({
          t: "tab.add",
          index: 0,
          tab: buildTab({ id: "phone", chatInputId: "in-phone" }),
        });
      });
      act(() => {
        fixture.emitHost({ t: "tab.remove", id: "b" });
      });
      expect(view.getActiveTabId()).toBe("a");
      expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-selected"))).toEqual([
        "false",
        "true",
      ]);
    });

    it("asks the host to close a tab without closing its backend session for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", () => {
      const { fixture } = renderStrip();
      fireEvent.click(screen.getAllByRole("button", { name: "Close session" })[0]);
      expect(fixture.commands).toEqual([{ name: "closeTab", sessionId: "a" }]);
    });

    it("creates a session in the view's scope, shows it and reports the creation for https://github.com/Brevilabs/obsidian-copilot-private/issues/317", async () => {
      const onCreated = jest.fn();
      const { fixture, view } = renderStrip({
        onCreated,
        onCommand: (command) =>
          command.name === "createSession"
            ? { ok: true, value: { sessionId: "fresh" } }
            : { ok: true, value: undefined },
      });
      fireEvent.click(screen.getByRole("button", { name: "New agent session" }));
      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
      expect(fixture.commands).toEqual([{ name: "createSession", projectId: GLOBAL }]);
      expect(view.getActiveTabId()).toBe("fresh");
    });

    it("does not report a creation the host refused", async () => {
      const onCreated = jest.fn();
      const { fixture, view } = renderStrip({
        onCreated,
        onCommand: () => ({ ok: false, code: "failed", message: "no" }),
      });
      fireEvent.click(screen.getByRole("button", { name: "New agent session" }));
      await waitFor(() => expect(fixture.commands).toHaveLength(1));
      expect(onCreated).not.toHaveBeenCalled();
      expect(view.getActiveTabId()).toBe("a");
    });

    it("renames a tab through the host when a new name is submitted", async () => {
      const { fixture } = renderStrip();
      fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
      fireEvent.click(await screen.findByText("Rename"));
      const input = await screen.findByDisplayValue("Alpha");
      fireEvent.change(input, { target: { value: "Renamed" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(fixture.commands).toEqual([
        { name: "renameSession", sessionId: "a", label: "Renamed" },
      ]);
    });

    it("disables the new-session button while the host is starting a session", () => {
      renderStrip({
        host: {
          backends: [],
          tabs: [buildTab({ id: "a" })],
          host: { defaultBackendId: null, startingBackendId: "claude", startFailed: false },
        },
      });
      expect(
        screen.getByRole("button", { name: "New agent session" }).hasAttribute("disabled")
      ).toBe(true);
    });

    it("shows a tab's status and attention state from the shared tab set", () => {
      const { container } = renderStrip({
        host: {
          backends: [],
          tabs: [
            buildTab({ id: "a", label: "Alpha", status: "running" }),
            buildTab({ id: "b", label: "Beta", needsAttention: true }),
          ],
        },
      });
      expect(container.querySelector(".tw-animate-spin")).not.toBeNull();
      expect(
        container.querySelector('[aria-hidden="true"].tw-bg-interactive-accent')
      ).not.toBeNull();
    });
  });
});
