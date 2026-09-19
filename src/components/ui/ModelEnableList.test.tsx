import modelEnableStories, { LockedCopilotCatalog } from "@/components/ui/ModelEnableList.stories";
import type { Meta } from "@/lib/story";
import { ModelEnableList, type ModelEnableGroup } from "@/components/ui/ModelEnableList";
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
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

describe("ModelEnableList", () => {
  describe("ModelEnableList()", () => {
    it("toggles an available model", () => {
      const onToggle = jest.fn();
      renderList({ onToggle });
      fireEvent.click(screen.getAllByRole("switch")[0]);
      expect(onToggle).toHaveBeenCalledWith("a-1", true);
    });

    it.each(["row", "icon", "toggle area", "keyboard"])(
      "links the locked %s to settings pricing without enabling the model (https://github.com/Brevilabs/obsidian-copilot-private/issues/476)",
      (action) => {
        const onToggle = jest.fn();
        renderList({
          groups: [
            {
              key: "copilot",
              label: "Copilot",
              rows: [{ id: "locked", label: "Locked model", enabled: false, locked: true }],
            },
          ],
          onToggle,
        });
        const link = screen.getByRole("link", { name: /Locked model/ });
        expect(link.getAttribute("href")).toBe(
          "https://www.obsidiancopilot.com/pricing?utm_source=obsidian_copilot&utm_medium=model_settings_lock"
        );
        expect(link.getAttribute("target")).toBe("_blank");
        expect(within(link).queryByRole("switch")).toBeNull();
        expect(link.querySelector("button, input, [tabindex]")).toBeNull();
        if (action === "keyboard") {
          link.focus();
          const enter = createEvent.keyDown(link, { key: "Enter" });
          fireEvent(link, enter);
          expect(enter.defaultPrevented).toBe(false);
          expect(document.activeElement).toBe(link);
        }
        const target =
          action === "icon"
            ? link.querySelector("svg")!
            : action === "toggle area"
              ? link.querySelector('[data-state="unchecked"]')!
              : link;
        const clicked = jest.fn();
        link.addEventListener("click", clicked);
        const click = createEvent.click(target, { detail: action === "keyboard" ? 0 : 1 });
        fireEvent(target, click);
        expect(click.defaultPrevented).toBe(false);
        expect(clicked).toHaveBeenCalledTimes(1);
        expect(onToggle).not.toHaveBeenCalled();
      }
    );
    it("renders the locked gallery catalog with all required controlled props (https://github.com/Brevilabs/obsidian-copilot-private/issues/427)", () => {
      type Props = React.ComponentProps<typeof ModelEnableList>;
      // Match the gallery's meta + story merge so omitted required args cannot hide behind renderList defaults.
      const args = {
        ...(modelEnableStories as Meta<Props>).args,
        ...LockedCopilotCatalog.args,
      } as Props;
      render(<ModelEnableList {...args} />);
      expect(screen.getByText("Copilot Plus Flash")).not.toBeNull();
      expect(screen.getByText("OpenRouter")).not.toBeNull();
      const toggles = screen.getAllByRole("switch");
      expect(toggles.map((toggle) => toggle.getAttribute("aria-disabled"))).toEqual([
        "false",
        "false",
      ]);
      expect(screen.getAllByRole("link")).toHaveLength(3);
    });

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
});
