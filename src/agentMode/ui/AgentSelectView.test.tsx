import type { AgentSelectRow, AgentSelectStatus } from "@/agentMode/ui/agentSelectModel";
import { AgentSelectView } from "@/agentMode/ui/AgentSelectView";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function row(overrides: Partial<AgentSelectRow> & Pick<AgentSelectRow, "id">): AgentSelectRow {
  return {
    name: overrides.id,
    description: `${overrides.id} description`,
    status: "absent",
    recommended: false,
    statusMessage: null,
    ...overrides,
  };
}

const ROWS: readonly AgentSelectRow[] = [
  row({ id: "opencode", recommended: true }),
  row({ id: "claude" }),
  row({ id: "codex" }),
];

function renderView(overrides: Partial<React.ComponentProps<typeof AgentSelectView>> = {}) {
  const props = {
    rows: ROWS,
    selectedId: "opencode" as const,
    onSelect: jest.fn(),
    ctaLabel: "Configure",
    footerNote: "opencode isn't set up on this machine yet.",
    onCta: jest.fn(),
    ...overrides,
  };
  render(<AgentSelectView {...props} />);
  return props;
}

describe("AgentSelectView", () => {
  describe("AgentSelectView()", () => {
    it("names the radiogroup after the visible heading and marks exactly one row checked", () => {
      renderView({ selectedId: "claude" });

      expect(screen.getByRole("radiogroup", { name: "Select your agent" })).toBeTruthy();
      const checked = screen
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true");
      expect(checked).toHaveLength(1);
      expect(checked[0].textContent).toContain("claude");
    });

    it("omits the redundant agent explanation", () => {
      renderView();

      expect(screen.queryByText(/An agent runs your tasks on this machine/)).toBeNull();
    });

    it.each<[AgentSelectStatus, string]>([
      ["checking", "Checking…"],
      ["installed", "Installed"],
      ["outdated", "Update required"],
      ["error", "Error"],
    ])("badges the %s status on the agent's row", (status, label) => {
      renderView({ rows: [row({ id: "claude", status })] });

      expect(screen.getByText(label)).toBeTruthy();
    });

    it("shows no status badge for an agent that is not set up", () => {
      renderView({ rows: [row({ id: "claude", status: "absent" })] });

      expect(screen.queryByText("Installed")).toBeNull();
      expect(screen.queryByText("Update required")).toBeNull();
      expect(screen.queryByText("Error")).toBeNull();
      expect(screen.queryByText(/not found/i)).toBeNull();
    });

    it("renders the recommendation badge on the row that carries it", () => {
      renderView();

      expect(screen.getAllByText("Recommended")).toHaveLength(1);
    });

    it("reports the clicked agent without running the call to action", () => {
      const { onSelect, onCta } = renderView();

      fireEvent.click(screen.getAllByRole("radio")[1]);

      expect(onSelect).toHaveBeenCalledWith("claude");
      expect(onCta).not.toHaveBeenCalled();
    });

    it("runs the call to action when its button is pressed", () => {
      const { onCta, onSelect } = renderView({ ctaLabel: "Start chat" });

      fireEvent.click(screen.getByRole("button", { name: "Start chat" }));

      expect(onCta).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("disables the call to action while readiness is being checked", () => {
      const { onCta } = renderView({ ctaLabel: "Checking…", ctaDisabled: true });

      fireEvent.click(screen.getByRole("button", { name: "Checking…" }));

      expect(onCta).not.toHaveBeenCalled();
    });

    it("moves the selection with the arrow keys, wrapping past both ends", () => {
      const { onSelect } = renderView();
      const radios = screen.getAllByRole("radio");

      fireEvent.keyDown(radios[0], { key: "ArrowDown" });
      expect(onSelect).toHaveBeenLastCalledWith("claude");

      fireEvent.keyDown(radios[0], { key: "ArrowUp" });
      expect(onSelect).toHaveBeenLastCalledWith("codex");
    });

    it("keeps the selected row as the group's only tab stop", () => {
      renderView({ selectedId: "codex" });

      expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("tabindex"))).toEqual([
        "-1",
        "-1",
        "0",
      ]);
    });

    it("shows the footer note beside the call to action", () => {
      renderView({ footerNote: "Ready to go." });

      expect(screen.getByText("Ready to go.")).toBeTruthy();
    });

    it("omits the footer note when the selected agent needs no attention", () => {
      renderView({ footerNote: null, ctaLabel: "Start chat" });

      expect(screen.queryByText("opencode isn't set up on this machine yet.")).toBeNull();
      expect(screen.getByRole("button", { name: "Start chat" })).toBeTruthy();
    });
  });
});
