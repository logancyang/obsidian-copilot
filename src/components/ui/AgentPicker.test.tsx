import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { AgentPicker, AgentPickerList, filterAgentRows, type AgentPickerRow } from "./AgentPicker";

const COPILOT: AgentPickerRow = {
  slug: "copilot",
  name: "Copilot",
  icon: "✦",
  description: "Your vault instructions, no persona, no memory.",
  modelKey: null,
  effort: null,
};

const JENNIFER: AgentPickerRow = {
  slug: "jennifer",
  name: "Jennifer",
  icon: "🪶",
  description: "Skeptical editor. Cuts fluff, argues for the reader.",
  modelKey: "other|agent",
  effort: "high",
};

/** A roster of `count` agents after Copilot, all unpinned. */
function roster(count: number): AgentPickerRow[] {
  return [
    COPILOT,
    ...Array.from({ length: count }, (_, i) => ({
      slug: `agent-${i + 1}`,
      name: `Agent ${i + 1}`,
      icon: "🟦",
      description: `Stands in for agent ${i + 1}.`,
      modelKey: null,
      effort: null,
    })),
  ];
}

describe("AgentPicker", () => {
  beforeAll(() => {
    window.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }));
  });

  describe("AgentPicker()", () => {
    function renderPicker(
      rows: AgentPickerRow[],
      handlers: { onSelect?: jest.Mock; onOpen?: jest.Mock } = {},
      selected = "copilot"
    ) {
      // Selection is caller-owned state in production too: the session manager
      // takes the pick and re-renders the picker with the new selectedSlug.
      const Harness = () => {
        const [selectedSlug, setSelectedSlug] = React.useState(selected);
        return (
          <AgentPicker
            section={{
              rows,
              selectedSlug,
              onSelect: (row) => {
                setSelectedSlug(row.slug);
                handlers.onSelect?.(row);
              },
              onOpen: handlers.onOpen,
            }}
          />
        );
      };
      render(<Harness />);
    }

    /** Open the roster from the composer trigger. */
    async function openRoster() {
      fireEvent.click(screen.getByTitle("Agent"));
      return within(await screen.findByRole("listbox", { name: "Agent" }));
    }

    it("names the current agent on the trigger with its icon, and holds no roster until clicked (designdocs/CUSTOM_AGENTS.md §3)", () => {
      renderPicker([COPILOT, JENNIFER]);

      expect(screen.getByTitle("Agent").textContent).toBe("✦Copilot");
      expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
    });

    it("names the chat's own agent on the trigger, so a reopened chat says who is answering it", () => {
      renderPicker([COPILOT, JENNIFER], {}, "jennifer");

      expect(screen.getByTitle("Agent").textContent).toBe("🪶Jennifer");
    });

    it("opens the whole roster in one click, each agent with its name and description", async () => {
      renderPicker([COPILOT, JENNIFER]);

      const list = await openRoster();

      expect(list.getAllByRole("option").map((row) => row.textContent)).toEqual([
        "✦CopilotYour vault instructions, no persona, no memory.",
        "🪶JenniferSkeptical editor. Cuts fluff, argues for the reader.",
      ]);
    });

    it("re-reads the roster as it opens, so an agent just created in Settings is offered", async () => {
      const onOpen = jest.fn();
      renderPicker([COPILOT], { onOpen });

      await openRoster();

      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it("opens scrolled to the current agent, however far down the roster it sits", async () => {
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      renderPicker(roster(11), {}, "agent-11");

      const list = await openRoster();

      expect(scrollIntoView).toHaveBeenCalled();
      expect(scrollIntoView.mock.instances[0]).toBe(list.getAllByRole("option")[11]);
    });

    it("reports the agent picked with its pins, closes, and renames the trigger", async () => {
      const onSelect = jest.fn();
      renderPicker([COPILOT, JENNIFER], { onSelect });

      const list = await openRoster();
      fireEvent.click(list.getByRole("option", { name: /Jennifer/ }));

      expect(onSelect).toHaveBeenCalledWith(JENNIFER);
      expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
      expect(screen.getByTitle("Agent").textContent).toBe("🪶Jennifer");
    });

    it("closes on Escape without reporting a pick", async () => {
      const onSelect = jest.fn();
      renderPicker([COPILOT, JENNIFER], { onSelect });

      const list = await openRoster();
      fireEvent.keyDown(list.getAllByRole("option")[0], { key: "Escape" });

      expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it.each([
      [6, false],
      [7, true],
    ])(
      "offers a search field for a roster of %i entries: %p (designdocs/CUSTOM_AGENTS.md §3)",
      async (count, expected) => {
        renderPicker(roster(count - 1));

        await openRoster();

        expect(Boolean(screen.queryByPlaceholderText("Search agents..."))).toBe(expected);
      }
    );

    it("narrows the roster to the agents whose name or description matches the search", async () => {
      renderPicker([...roster(6), JENNIFER]);

      const list = await openRoster();
      fireEvent.change(screen.getByPlaceholderText("Search agents..."), {
        target: { value: "SKEPTICAL edit" },
      });

      expect(list.getAllByRole("option").map((row) => row.textContent)).toEqual([
        "🪶JenniferSkeptical editor. Cuts fluff, argues for the reader.",
      ]);
    });

    it("forgets the last search when reopened, so the roster opens whole", async () => {
      renderPicker([...roster(6), JENNIFER]);

      await openRoster();
      fireEvent.change(screen.getByPlaceholderText("Search agents..."), {
        target: { value: "skeptical" },
      });
      fireEvent.keyDown(screen.getAllByRole("option")[0], { key: "Escape" });
      const reopened = await openRoster();

      expect(reopened.getAllByRole("option")).toHaveLength(8);
    });

    it("moves through the roster with the arrow keys and picks with Enter", async () => {
      const onSelect = jest.fn();
      renderPicker([COPILOT, JENNIFER], { onSelect });

      const list = await openRoster();
      const first = list.getAllByRole("option")[0];
      fireEvent.keyDown(first, { key: "ArrowDown" });
      fireEvent.keyDown(first, { key: "Enter" });

      expect(onSelect).toHaveBeenCalledWith(JENNIFER);
      expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
    });

    it("wraps the arrow keys around the ends of the roster", async () => {
      const onSelect = jest.fn();
      renderPicker([COPILOT, JENNIFER], { onSelect });

      const list = await openRoster();
      const first = list.getAllByRole("option")[0];
      fireEvent.keyDown(first, { key: "ArrowUp" });
      fireEvent.keyDown(first, { key: "Enter" });

      expect(onSelect).toHaveBeenCalledWith(JENNIFER);
    });
  });

  describe("filterAgentRows()", () => {
    const rows = [
      {
        slug: "copilot",
        name: "Copilot",
        icon: "✦",
        description: "No persona, no memory.",
        modelKey: null,
        effort: null,
      },
      {
        slug: "jennifer",
        name: "Jennifer",
        icon: "🪶",
        description: "Skeptical editor.",
        modelKey: null,
        effort: null,
      },
    ];

    it("returns the roster untouched, and by the same reference, for a blank query", () => {
      expect(filterAgentRows(rows, "   ")).toBe(rows);
    });

    it.each([
      ["name", "jenn"],
      ["name in another case", "JENNIFER"],
      ["description", "skeptical"],
    ])("matches on %s", (_label, query) => {
      expect(filterAgentRows(rows, query).map((row) => row.slug)).toEqual(["jennifer"]);
    });

    it("returns nothing when neither name nor description matches", () => {
      expect(filterAgentRows(rows, "vancat")).toEqual([]);
    });
  });

  describe("AgentPickerList()", () => {
    const row = {
      slug: "jennifer",
      name: "Jennifer",
      icon: "🪶",
      description: "Skeptical editor.",
      modelKey: null,
      effort: null,
    };

    it("tints the selected agent and keeps the keyboard highlight visible on another row", () => {
      render(
        <AgentPickerList
          rows={[row, { ...row, slug: "vancat", name: "Vancat" }]}
          selectedSlug="jennifer"
          highlightSlug="vancat"
          onPick={jest.fn()}
        />
      );

      const [jennifer, vancat] = screen.getAllByRole("option");
      expect(jennifer.getAttribute("aria-selected")).toBe("true");
      expect(jennifer.className).toContain("tw-bg-interactive-accent-hsl/10");
      expect(jennifer.querySelector(".tw-font-medium")?.textContent).toBe("Jennifer");
      expect(jennifer.textContent).toBe("🪶JenniferSkeptical editor.");
      expect(vancat.getAttribute("data-highlighted")).toBe("true");
      expect(vancat.className).toContain("tw-bg-interactive-hover");
      expect(vancat.className).not.toContain("tw-bg-interactive-accent-hsl/10");
    });

    it("keeps the tint on the selected agent when the keyboard highlight lands back on it", () => {
      render(
        <AgentPickerList
          rows={[row]}
          selectedSlug="jennifer"
          highlightSlug="jennifer"
          onPick={jest.fn()}
        />
      );

      const [jennifer] = screen.getAllByRole("option");
      expect(jennifer.getAttribute("aria-selected")).toBe("true");
      expect(jennifer.className).toContain("tw-bg-interactive-accent-hsl/10");
      expect(jennifer.className).not.toContain("tw-bg-interactive-hover");
    });

    it("moves the highlight onto the row the pointer is over, so hovering and arrowing paint the same row", () => {
      const onHighlight = jest.fn();
      render(
        <AgentPickerList
          rows={[row, { ...row, slug: "vancat", name: "Vancat" }]}
          selectedSlug="jennifer"
          highlightSlug="jennifer"
          onPick={jest.fn()}
          onHighlight={onHighlight}
        />
      );

      const [jennifer, vancat] = screen.getAllByRole("option");
      fireEvent.pointerMove(vancat);
      expect(onHighlight).toHaveBeenCalledWith(expect.objectContaining({ slug: "vancat" }));
      // The row already highlighted reports nothing, so a still pointer never re-renders.
      fireEvent.pointerMove(jennifer);
      expect(onHighlight).toHaveBeenCalledTimes(1);
    });

    it("omits the search field when the caller supplies none", () => {
      render(<AgentPickerList rows={[row]} selectedSlug="jennifer" onPick={jest.fn()} />);

      expect(screen.queryByPlaceholderText("Search agents...")).toBeNull();
    });

    it("reports an empty roster rather than an empty box", () => {
      render(
        <AgentPickerList
          rows={[]}
          selectedSlug="jennifer"
          search={{ query: "zz", onChange: jest.fn() }}
          onPick={jest.fn()}
        />
      );

      expect(screen.getByText("No matching agents")).toBeTruthy();
      expect(screen.queryAllByRole("option")).toEqual([]);
    });
  });
});
