import { ModelEnableList, type ModelEnableGroup } from "@/agentMode/ui/ModelEnableList";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// Two provider groups, one row each, so we can assert per-group open/closed.
const GROUPS: ModelEnableGroup[] = [
  {
    key: "provider-a",
    label: "Provider A",
    rows: [{ id: "a-1", label: "Model A1", enabled: false }],
  },
  {
    key: "provider-b",
    label: "Provider B",
    rows: [{ id: "b-1", label: "Model B1", enabled: false }],
  },
];

/**
 * Radix Collapsible keeps collapsed content mounted but marks the trigger/root
 * with `data-state="closed"`. Read the group's open state off its heading's
 * nearest `[data-state]` ancestor rather than DOM presence.
 */
function groupState(label: string): string | null | undefined {
  const heading = screen.getByText(label);
  return heading.closest("[data-state]")?.getAttribute("data-state");
}

function renderList(props?: Partial<React.ComponentProps<typeof ModelEnableList>>) {
  const onQueryChange = jest.fn();
  const utils = render(
    <ModelEnableList
      groups={GROUPS}
      onToggle={jest.fn()}
      query=""
      onQueryChange={onQueryChange}
      {...props}
    />
  );
  return { onQueryChange, ...utils };
}

describe("ModelEnableList — default group expansion", () => {
  it("opens every group by default when no defaultOpenGroupKey is given", () => {
    renderList();
    expect(groupState("Provider A")).toBe("open");
    expect(groupState("Provider B")).toBe("open");
  });

  it("opens only the defaultOpenGroupKey group, collapsing the rest", () => {
    renderList({ defaultOpenGroupKey: "provider-a" });
    expect(groupState("Provider A")).toBe("open");
    expect(groupState("Provider B")).toBe("closed");
  });

  it("forces every group open while searching, ignoring the default", () => {
    renderList({ defaultOpenGroupKey: "provider-a", query: "Model" });
    expect(groupState("Provider A")).toBe("open");
    expect(groupState("Provider B")).toBe("open");
  });

  it("re-applies the collapsed default once the search query clears", () => {
    const { rerender } = renderList({ defaultOpenGroupKey: "provider-a", query: "Model" });
    // Searching → both open.
    expect(groupState("Provider B")).toBe("open");
    // Query cleared → the untouched non-default group collapses again.
    rerender(
      <ModelEnableList
        groups={GROUPS}
        onToggle={jest.fn()}
        query=""
        onQueryChange={jest.fn()}
        defaultOpenGroupKey="provider-a"
      />
    );
    expect(groupState("Provider A")).toBe("open");
    expect(groupState("Provider B")).toBe("closed");
  });

  it("remembers a user's explicit expand of a non-default group across props updates", () => {
    const { rerender } = renderList({ defaultOpenGroupKey: "provider-a" });
    // User expands the collapsed second group.
    fireEvent.click(screen.getByText("Provider B"));
    expect(groupState("Provider B")).toBe("open");
    // A later props update (e.g. model discovery re-derives groups) must not
    // clobber the user's intent.
    rerender(
      <ModelEnableList
        groups={GROUPS}
        onToggle={jest.fn()}
        query=""
        onQueryChange={jest.fn()}
        defaultOpenGroupKey="provider-a"
      />
    );
    expect(groupState("Provider B")).toBe("open");
  });

  it("applies the collapsed default to groups that appear after an empty first render", () => {
    // Groups can arrive asynchronously (backend model discovery): first render
    // empty, then populated. Late-arriving groups must still honor the default.
    const { rerender } = render(
      <ModelEnableList
        groups={[]}
        onToggle={jest.fn()}
        query=""
        onQueryChange={jest.fn()}
        defaultOpenGroupKey="provider-a"
      />
    );
    rerender(
      <ModelEnableList
        groups={GROUPS}
        onToggle={jest.fn()}
        query=""
        onQueryChange={jest.fn()}
        defaultOpenGroupKey="provider-a"
      />
    );
    expect(groupState("Provider A")).toBe("open");
    expect(groupState("Provider B")).toBe("closed");
  });
});
