import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { AgentSpotlight, countInlineAgents, type AgentPickerRow } from "./AgentRoster";

function row(slug: string, name: string, description = ""): AgentPickerRow {
  return { slug, name, avatarSrc: null, description };
}

const COPILOT = row("copilot", "Copilot", "Your vault instructions, no persona, no memory.");
const SAGE = row("sage", "Sage", "Chief of staff.");
const REX = row("rex", "Rex", "Red team.");
const PIP = row("pip", "Pip", "Explains like you're nine.");
const QUILL = row("quill", "Quill", "Vault archivist.");

let stripEntries = 10;

function stripLabels(): string[] {
  return within(screen.getByRole("group", { name: "Who do you want to talk to?" }))
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

describe("AgentRoster", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    window.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }));
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 64,
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => stripEntries * 64,
    });
  });

  beforeEach(() => {
    stripEntries = 10;
  });

  describe("countInlineAgents()", () => {
    it("shows every agent when they fit beside Copilot and New", () => {
      expect(countInlineAgents(6, 4)).toBe(4);
    });

    it("gives one slot to the +N menu when the roster does not fit", () => {
      expect(countInlineAgents(6, 5)).toBe(3);
    });

    it("shows no agent inline on the narrowest strip, which is Copilot, +N, New", () => {
      expect(countInlineAgents(3, 4)).toBe(0);
      expect(countInlineAgents(1, 4)).toBe(0);
    });
  });

  describe("AgentSpotlight()", () => {
    it("asks who to talk to and spotlights the selected agent's name and description", () => {
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT, SAGE, REX], selectedSlug: "sage", onSelect: jest.fn() }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      expect(screen.getByRole("heading", { name: "Who do you want to talk to?" })).toBeTruthy();
      expect(screen.getByText("Chief of staff.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sage" }).getAttribute("aria-pressed")).toBe(
        "true"
      );
    });

    it("selects an agent with one click on its face, handing over its row and pins", () => {
      const onSelect = jest.fn();
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT, SAGE, REX], selectedSlug: "copilot", onSelect }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Rex" }));

      expect(onSelect).toHaveBeenCalledWith(REX);
    });

    it("leads with Copilot and ends with New, with every agent between when they fit", () => {
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT, SAGE, REX], selectedSlug: "copilot", onSelect: jest.fn() }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      expect(stripLabels()).toEqual(["Copilot", "SSage", "RRex", "New"]);
    });

    it("folds the agents that do not fit into a +N entry before New, never scrolling", () => {
      stripEntries = 4;
      render(
        <AgentSpotlight
          section={{
            rows: [COPILOT, SAGE, REX, PIP, QUILL],
            selectedSlug: "copilot",
            onSelect: jest.fn(),
          }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      expect(stripLabels()).toEqual(["Copilot", "SSage", "+3More", "New"]);
    });

    it("keeps the selected agent inline even when it sits past the fold, like an active tab", () => {
      stripEntries = 4;
      render(
        <AgentSpotlight
          section={{
            rows: [COPILOT, SAGE, REX, PIP, QUILL],
            selectedSlug: "quill",
            onSelect: jest.fn(),
          }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      expect(stripLabels()).toEqual(["Copilot", "QQuill", "+3More", "New"]);
    });

    it("picks a folded agent from the +N menu", () => {
      stripEntries = 3;
      const onSelect = jest.fn();
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT, SAGE, REX], selectedSlug: "copilot", onSelect }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      fireEvent.pointerDown(screen.getByRole("button", { name: "2 more agents" }), { button: 0 });
      fireEvent.click(screen.getByRole("menuitem", { name: /Rex/ }));

      expect(onSelect).toHaveBeenCalledWith(REX);
    });

    it("opens a custom agent's settings page from its spotlighted face", () => {
      const onOpenAgent = jest.fn();
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT, SAGE], selectedSlug: "sage", onSelect: jest.fn() }}
          onCreateAgent={jest.fn()}
          onOpenAgent={onOpenAgent}
          onOpenScratchpad={jest.fn()}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Edit Sage" }));

      expect(onOpenAgent).toHaveBeenCalledWith(SAGE);
    });

    it("leaves Copilot's face a picture, since the built-in has no settings page", () => {
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT, SAGE], selectedSlug: "copilot", onSelect: jest.fn() }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    });

    it("opens a custom agent's scratchpad from the icon beside its name", () => {
      const onOpenScratchpad = jest.fn();
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT, SAGE], selectedSlug: "sage", onSelect: jest.fn() }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={onOpenScratchpad}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Open Sage's scratchpad" }));

      expect(onOpenScratchpad).toHaveBeenCalledWith(SAGE);
    });

    it("offers no scratchpad for Copilot, which keeps none", () => {
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT, SAGE], selectedSlug: "copilot", onSelect: jest.fn() }}
          onCreateAgent={jest.fn()}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      expect(screen.queryByRole("button", { name: /scratchpad/ })).toBeNull();
    });

    it("opens agent creation from New", () => {
      const onCreateAgent = jest.fn();
      render(
        <AgentSpotlight
          section={{ rows: [COPILOT], selectedSlug: "copilot", onSelect: jest.fn() }}
          onCreateAgent={onCreateAgent}
          onOpenAgent={jest.fn()}
          onOpenScratchpad={jest.fn()}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Create an agent" }));

      expect(onCreateAgent).toHaveBeenCalledTimes(1);
    });
  });
});
