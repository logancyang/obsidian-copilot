import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ModelChecklist } from "./ModelChecklist";
import type { ModelInfo } from "@/modelManagement/types/catalog";

function renderList(overrides: Partial<React.ComponentProps<typeof ModelChecklist>> = {}) {
  const props: React.ComponentProps<typeof ModelChecklist> = {
    availableModels: [],
    selected: new Set<string>(),
    onToggle: jest.fn(),
    onAddId: jest.fn(),
    ...overrides,
  };
  render(<ModelChecklist {...props} />);
  return props;
}

const RICH: ModelInfo = {
  id: "claude-sonnet-4-5",
  displayName: "Claude Sonnet 4.5",
  releaseDate: "2025-09-01",
  limits: { context: 200000 },
};

const PLAIN: ModelInfo = { id: "gpt-5", displayName: "gpt-5" };

const EMBED: ModelInfo = {
  id: "nomic-embed-text",
  displayName: "nomic-embed-text",
  isEmbedding: true,
};

describe("ModelChecklist", () => {
  it("renders the empty state with a manual-add hint when there are no models", () => {
    renderList();
    expect(screen.getByTestId("model-checklist-empty")).toBeTruthy();
  });

  it("renders one row per model with metadata when available", () => {
    renderList({ availableModels: [RICH, PLAIN] });
    expect(screen.getByTestId("model-row-claude-sonnet-4-5")).toBeTruthy();
    expect(screen.getByTestId("model-row-gpt-5")).toBeTruthy();
  });

  it("shows an Embedding badge for embedding models", () => {
    renderList({ availableModels: [EMBED] });
    expect(screen.getByText("Embedding")).toBeTruthy();
  });

  it("renders read-only capability icons derived from ModelInfo", () => {
    const VISION_REASON: ModelInfo = {
      id: "omni",
      displayName: "Omni",
      modalities: { input: ["text", "image"] },
      reasoning: true,
    };
    const { container } = render(
      <ModelChecklist
        availableModels={[VISION_REASON, PLAIN]}
        selected={new Set<string>()}
        onToggle={jest.fn()}
        onAddId={jest.fn()}
      />
    );
    const omniRow = screen.getByTestId("model-row-omni");
    // Lightbulb (reasoning) + Eye (vision) render as two SVG icons.
    expect(omniRow.querySelectorAll("svg").length).toBe(2);
    // A plain model shows no capability icons.
    expect(screen.getByTestId("model-row-gpt-5").querySelectorAll("svg").length).toBe(0);
    expect(container).toBeTruthy();
  });

  it("emits onToggle with the wire id when a checkbox is clicked", () => {
    const onToggle = jest.fn();
    renderList({ availableModels: [PLAIN], onToggle });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith("gpt-5", true);
  });

  it("emits onAddId on Enter and clears the input", () => {
    const onAddId = jest.fn();
    renderList({ onAddId });
    const input = screen.getByTestId<HTMLInputElement>("model-checklist-manual-input");
    fireEvent.change(input, { target: { value: "claude-haiku-4-5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddId).toHaveBeenCalledWith("claude-haiku-4-5");
    expect(input.value).toBe("");
  });

  it("trims whitespace and ignores blank manual submits", () => {
    const onAddId = jest.fn();
    renderList({ onAddId });
    const input = screen.getByTestId<HTMLInputElement>("model-checklist-manual-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddId).not.toHaveBeenCalled();
  });

  it("shows the X button only for custom ids and emits onRemoveId on click", () => {
    const onRemoveId = jest.fn();
    renderList({
      availableModels: [RICH, PLAIN],
      onRemoveId,
      customIds: new Set([PLAIN.id]),
    });
    expect(screen.queryByTestId(`model-row-remove-${RICH.id}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`model-row-remove-${PLAIN.id}`));
    expect(onRemoveId).toHaveBeenCalledWith(PLAIN.id);
  });

  it("hides the X button on every row when customIds is omitted", () => {
    renderList({
      availableModels: [RICH, PLAIN],
      onRemoveId: jest.fn(),
    });
    expect(screen.queryByTestId(`model-row-remove-${RICH.id}`)).toBeNull();
    expect(screen.queryByTestId(`model-row-remove-${PLAIN.id}`)).toBeNull();
  });

  it("floats custom ids above discovered ones within each selection group", () => {
    const olderCustom: ModelInfo = {
      id: "custom-old",
      displayName: "custom-old",
      releaseDate: "2024-01-01",
    };
    renderList({
      availableModels: [RICH, olderCustom],
      customIds: new Set([olderCustom.id]),
    });
    const rows = screen.getAllByRole("listitem");
    // olderCustom is custom-added, even though RICH has a newer releaseDate.
    expect(rows[0].getAttribute("data-testid")).toBe(`model-row-${olderCustom.id}`);
    expect(rows[1].getAttribute("data-testid")).toBe(`model-row-${RICH.id}`);
  });

  it("renders the loading state when fetching", () => {
    renderList({ fetching: true });
    expect(screen.getAllByText("Loading models…").length).toBeGreaterThan(0);
  });

  it("surfaces a fetch error inline", () => {
    renderList({ fetchError: "Authentication failed" });
    expect(screen.getByText("Authentication failed")).toBeTruthy();
  });

  it("filters by the search query against name + id", () => {
    renderList({
      availableModels: [RICH, PLAIN, { id: "gemini-2.0-flash", displayName: "Gemini 2 Flash" }],
      query: "gemini",
    });
    expect(screen.queryByTestId("model-row-gemini-2.0-flash")).toBeTruthy();
    expect(screen.queryByTestId(`model-row-${RICH.id}`)).toBeNull();
    expect(screen.queryByTestId("model-row-gpt-5")).toBeNull();
  });

  it("sorts checked models to the top", () => {
    renderList({
      availableModels: [RICH, PLAIN],
      selected: new Set([PLAIN.id]),
    });
    const rows = screen.getAllByRole("listitem");
    // PLAIN is checked, should come first
    expect(rows[0].getAttribute("data-testid")).toBe(`model-row-${PLAIN.id}`);
  });
});
