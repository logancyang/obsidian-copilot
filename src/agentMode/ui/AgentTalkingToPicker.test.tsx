import { BUILTIN_AGENT, toAgentEntry, type CustomAgent } from "@/agents/types";
import { AgentTalkingToPicker } from "@/agentMode/ui/AgentTalkingToPicker";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function customAgent(overrides: Partial<CustomAgent> & { slug: string }): CustomAgent {
  return {
    name: overrides.slug,
    description: "",
    icon: "🙂",
    backendId: null,
    modelId: null,
    memoryEnabled: true,
    created: "2026-09-16T10:00:00Z",
    instructions: "",
    ...overrides,
  };
}

const JENNIFER = toAgentEntry(
  customAgent({
    slug: "jennifer",
    name: "Jennifer",
    icon: "🪶",
    description: "Skeptical editor. Cuts fluff, argues for the reader.",
  })
);

describe("AgentTalkingToPicker", () => {
  // Radix's menu needs Pointer Events and an `activeDocument` to portal into,
  // neither of which jsdom provides.
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  describe("AgentTalkingToPicker()", () => {
    it("reads Copilot when nothing else has been chosen", () => {
      render(
        <AgentTalkingToPicker
          entries={[BUILTIN_AGENT]}
          selectedSlug={BUILTIN_AGENT.slug}
          onSelect={jest.fn()}
        />
      );

      expect(screen.getByRole("button", { name: "Talking to Copilot" })).toBeTruthy();
    });

    it("shows the chosen agent's name on the trigger", () => {
      render(
        <AgentTalkingToPicker
          entries={[BUILTIN_AGENT, JENNIFER]}
          selectedSlug="jennifer"
          onSelect={jest.fn()}
        />
      );

      expect(screen.getByRole("button", { name: "Talking to Jennifer" })).toBeTruthy();
    });

    it("falls back to the first entry when the selected agent is gone", () => {
      // A delete can land while the header is mounted; the trigger must not
      // render empty. `designdocs/CUSTOM_AGENTS.md` §1.
      render(
        <AgentTalkingToPicker
          entries={[BUILTIN_AGENT]}
          selectedSlug="jennifer"
          onSelect={jest.fn()}
        />
      );

      expect(screen.getByRole("button", { name: "Talking to Copilot" })).toBeTruthy();
    });

    it("lists every agent with its description and reports the one clicked", () => {
      const onSelect = jest.fn();
      const onOpen = jest.fn();
      render(
        <AgentTalkingToPicker
          entries={[BUILTIN_AGENT, JENNIFER]}
          selectedSlug={BUILTIN_AGENT.slug}
          onSelect={onSelect}
          onOpen={onOpen}
        />
      );

      // Radix opens its menu on pointerdown, which jsdom does not synthesize
      // from a click.
      fireEvent.pointerDown(screen.getByRole("button", { name: "Talking to Copilot" }), {
        button: 0,
        ctrlKey: false,
      });

      // The menu re-reads the agents folder as it opens, so an agent created in
      // Settings a moment ago is listed without a reload.
      expect(onOpen).toHaveBeenCalled();
      expect(screen.getByText("Skeptical editor. Cuts fluff, argues for the reader.")).toBeTruthy();

      fireEvent.click(screen.getByText("Jennifer"));

      expect(onSelect).toHaveBeenCalledWith("jennifer");
    });
  });
});
