import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { AgentPickerList, filterAgentRows, ModelEffortPicker } from "./ModelEffortPicker";

const models = [{ name: "model", provider: "agent", enabled: true }];
const options = ["high", "low"].map((value) => ({ value, label: value }));

describe("ModelEffortPicker", () => {
  beforeAll(() => {
    window.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }));
  });
  describe("ModelEffortPicker()", () => {
    it("commits an available model only when dismissed", async () => {
      const commitSelection = jest.fn();
      render(
        <ModelEffortPicker
          override={{
            models: [...models, { name: "other", provider: "agent", enabled: true }],
            value: "model|agent",
            effortOptionsByModelKey: {},
            commitSelection,
          }}
        />
      );
      fireEvent.click(screen.getByTitle("Model · effort"));
      fireEvent.click(await screen.findByRole("option", { name: /other/ }));
      expect(commitSelection).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(commitSelection).toHaveBeenCalledWith("other|agent", null);
    });

    it.each(["row", "icon", "keyboard", "Tab", "Shift+Tab", "middle-click"])(
      "preserves native pricing navigation and discards pending edits after %s interaction with a locked row (https://github.com/Brevilabs/obsidian-copilot-private/issues/476)",
      async (action) => {
        const commitSelection = jest.fn();
        const onChange = jest.fn();
        render(
          <ModelEffortPicker
            override={{
              models: [
                ...models,
                { name: "other", provider: "agent", enabled: true },
                {
                  name: "locked",
                  provider: "copilot-plus",
                  enabled: true,
                  _needsLicense: true,
                  _disabledReason: "Copilot license required",
                },
              ],
              value: "model|agent",
              effort: { options, value: "high", onChange },
              effortOptionsByModelKey: { "model|agent": options },
              commitSelection,
            }}
          />
        );
        fireEvent.click(screen.getByTitle("Model · effort"));
        const dialog = await screen.findByRole("dialog");
        if (action === "icon") {
          fireEvent.keyDown(dialog, { key: "ArrowRight" });
          expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("1");
        } else {
          fireEvent.click(screen.getByRole("option", { name: /other/ }));
        }
        const link = screen.getByRole("link", { name: /locked/ });
        expect(link.getAttribute("href")).toBe(
          "https://obsidiancopilot.com/pricing?utm_source=obsidian-copilot&utm_medium=model-picker-lock"
        );
        expect(link.getAttribute("target")).toBe("_blank");
        if (action === "keyboard") {
          act(() => link.focus());
          const enter = createEvent.keyDown(link, { key: "Enter" });
          fireEvent(link, enter);
          expect(enter.defaultPrevented).toBe(false);
          expect(document.activeElement).toBe(link);
        }
        if (action === "Tab" || action === "Shift+Tab") {
          act(() => link.focus());
          const tab = createEvent.keyDown(link, { key: "Tab", shiftKey: action === "Shift+Tab" });
          fireEvent(link, tab);
          // The drafted model has no effort slider, so this link is both focus-loop boundaries.
          expect(tab.defaultPrevented).toBe(true);
          expect(document.activeElement).toBe(link);
          expect(screen.getByRole("dialog")).toBe(dialog);
          expect(screen.getByRole("option", { name: /other/ }).getAttribute("aria-selected")).toBe(
            "true"
          );
          expect(commitSelection).not.toHaveBeenCalled();
          expect(onChange).not.toHaveBeenCalled();
        }
        const target =
          action === "icon"
            ? within(link)
                .getByText("Copilot license required")
                .parentElement!.querySelector("svg")!
            : link;
        const click =
          action === "middle-click"
            ? new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })
            : createEvent.click(target, { detail: action === "keyboard" ? 0 : 1 });
        fireEvent(target, click);
        expect(click.defaultPrevented).toBe(false);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(commitSelection).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTitle("Model · effort"));
        expect(
          (await screen.findByRole("option", { name: /^model/ })).getAttribute("aria-selected")
        ).toBe("true");
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        expect(commitSelection).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
      }
    );

    it("keeps models disabled for other reasons unavailable", async () => {
      const commitSelection = jest.fn();
      render(
        <ModelEffortPicker
          override={{
            models: [
              ...models,
              {
                name: "unavailable",
                provider: "agent",
                enabled: true,
                _disabledReason: "Agent unavailable",
              },
            ],
            value: "model|agent",
            effortOptionsByModelKey: {},
            commitSelection,
          }}
        />
      );
      fireEvent.click(screen.getByTitle("Model · effort"));
      const row = await screen.findByRole("option", { name: /unavailable/ });
      expect(row.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(row);
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(commitSelection).not.toHaveBeenCalled();
      expect(screen.queryByRole("link")).toBeNull();
    });
    it.each([null, "removed"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 resolves effort %p to the lowest supported choice when committing the picker",
      async (value) => {
        const onChange = jest.fn();
        render(
          <ModelEffortPicker
            override={{
              models,
              value: "model|agent",
              effort: { options, value, onChange },
              effortOptionsByModelKey: { "model|agent": options },
              commitSelection: jest.fn(),
            }}
          />
        );
        fireEvent.click(screen.getByTitle("Model · effort"));
        fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
        expect(onChange).toHaveBeenCalledWith("low");
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 preserves a supported effort when the picker closes unchanged", async () => {
      const onChange = jest.fn();
      render(
        <ModelEffortPicker
          override={{
            models,
            value: "model|agent",
            effort: { options, value: "high", onChange },
            effortOptionsByModelKey: { "model|agent": options },
            commitSelection: jest.fn(),
          }}
        />
      );
      fireEvent.click(screen.getByTitle("Model · effort"));
      fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
      expect(onChange).not.toHaveBeenCalled();
    });

    describe("Agent section", () => {
      const COPILOT = {
        slug: "copilot",
        name: "Copilot",
        icon: "✦",
        description: "Your vault instructions, no persona, no memory.",
        modelKey: null,
        effort: null,
      };
      const agentModels = [
        { name: "model", provider: "agent", enabled: true },
        { name: "other", provider: "agent", enabled: true },
      ];
      const effortByKey = { "model|agent": options, "other|agent": options };

      function renderWithAgents(
        rows: { slug: string; modelKey: string | null; effort: string | null }[],
        handlers: {
          onSelect?: jest.Mock;
          onOpen?: jest.Mock;
          commitSelection?: jest.Mock;
          onEffortChange?: jest.Mock;
        } = {}
      ) {
        // Selection is caller-owned state in production too: the session manager
        // takes the pick and re-renders the picker with the new selectedSlug.
        const Harness = () => {
          const [selectedSlug, setSelectedSlug] = React.useState("copilot");
          return (
            <ModelEffortPicker
              override={{
                models: agentModels,
                value: "model|agent",
                effort: {
                  options,
                  value: "high",
                  onChange: handlers.onEffortChange ?? jest.fn(),
                },
                effortOptionsByModelKey: effortByKey,
                commitSelection: handlers.commitSelection ?? jest.fn(),
                agents: {
                  rows: rows.map((row) => ({
                    name: row.slug,
                    icon: "🪶",
                    description: `${row.slug} description`,
                    ...row,
                  })),
                  selectedSlug,
                  onSelect: (slug: string) => {
                    setSelectedSlug(slug);
                    handlers.onSelect?.(slug);
                  },
                  onOpen: handlers.onOpen,
                },
              }}
            />
          );
        };
        render(<Harness />);
        fireEvent.click(screen.getByTitle("Model · effort"));
      }

      /** Open the nested roster from the Agent section's select row. */
      async function openRoster() {
        fireEvent.click(await screen.findByRole("combobox", { name: "Agent" }));
        return within(await screen.findByRole("listbox", { name: "Agent" }));
      }

      /** A roster of `count` agents after Copilot, all unpinned. */
      function roster(count: number) {
        return [
          COPILOT,
          ...Array.from({ length: count }, (_, i) => ({
            slug: `agent-${i + 1}`,
            modelKey: null,
            effort: null,
          })),
        ];
      }

      it("shows the current agent as one row above the model group, with no roster inline (designdocs/CUSTOM_AGENTS.md §3)", async () => {
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: null, effort: null }]);

        const row = await screen.findByRole("combobox", { name: "Agent" });
        expect(row.textContent).toBe("✦Copilot");
        expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
        // The glyph leads the row: no column is reserved for a check this row
        // can never carry, so the agent starts where a model row's ✓ does.
        expect(row.querySelectorAll("[aria-hidden]")).toHaveLength(1);
        const modelBox = screen.getByRole("listbox", { name: "Model" });
        expect(
          row.compareDocumentPosition(modelBox) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      });

      it("opens the whole roster on the row, with the current agent checked", async () => {
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: null, effort: null }]);

        const list = await openRoster();
        expect(list.getAllByRole("option").map((row) => row.textContent)).toEqual([
          "✓✦CopilotYour vault instructions, no persona, no memory.",
          "🪶jenniferjennifer description",
        ]);
        expect(screen.getByRole("combobox", { name: "Agent" }).getAttribute("aria-expanded")).toBe(
          "true"
        );
      });

      it("leaves the model and effort sections where they are when the roster opens (designdocs/CUSTOM_AGENTS.md §3)", async () => {
        renderWithAgents(roster(11));

        const body = screen.getByRole("listbox", { name: "Model" }).parentElement!;
        const childrenBefore = body.childElementCount;
        const list = await openRoster();

        expect(body.childElementCount).toBe(childrenBefore);
        expect(body.contains(list.getAllByRole("option")[0])).toBe(false);
        expect(screen.getByRole("listbox", { name: "Model" }).parentElement).toBe(body);
      });

      it("opens the roster scrolled to the current agent, however far down the roster it sits", async () => {
        const scrollIntoView = jest.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        renderWithAgents(roster(11));

        const list = await openRoster();

        expect(scrollIntoView).toHaveBeenCalled();
        expect(scrollIntoView.mock.instances[0]).toBe(list.getAllByRole("option")[0]);
      });

      it("re-reads the roster as the popover opens, so an agent just created is offered", () => {
        const onOpen = jest.fn();
        renderWithAgents([COPILOT], { onOpen });

        expect(onOpen).toHaveBeenCalledTimes(1);
      });

      it("closes the roster and updates the row when an agent is chosen", async () => {
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: null, effort: null }]);

        const list = await openRoster();
        fireEvent.click(list.getByRole("option", { name: /jennifer/ }));

        expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
        expect(screen.getByRole("combobox", { name: "Agent" }).textContent).toBe("🪶jennifer");
      });

      it("closes only the roster on Escape, leaving the popover and its model group open (designdocs/CUSTOM_AGENTS.md §3)", async () => {
        const commitSelection = jest.fn();
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: null, effort: null }], {
          commitSelection,
        });

        const list = await openRoster();
        fireEvent.keyDown(list.getAllByRole("option")[0], { key: "Escape" });

        expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
        expect(screen.getByRole("listbox", { name: "Model" })).toBeTruthy();
        expect(commitSelection).not.toHaveBeenCalled();
      });

      it("drafts the pinned model and effort of the agent picked, and commits both on dismiss (designdocs/CUSTOM_AGENTS.md §3)", async () => {
        const onSelect = jest.fn();
        const commitSelection = jest.fn();
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: "other|agent", effort: "low" }], {
          onSelect,
          commitSelection,
        });

        const list = await openRoster();
        fireEvent.click(list.getByRole("option", { name: /jennifer/ }));

        expect(onSelect).toHaveBeenCalledWith("jennifer");
        // The effort section follows the pick at once, before any dismissal.
        expect(screen.getByText("low")).toBeTruthy();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        expect(commitSelection).toHaveBeenCalledWith("other|agent", "low");
      });

      it("leaves the model and effort where the user left them for an agent that pins neither", async () => {
        const commitSelection = jest.fn();
        const onEffortChange = jest.fn();
        renderWithAgents([COPILOT, { slug: "vancat", modelKey: null, effort: null }], {
          commitSelection,
          onEffortChange,
        });

        const list = await openRoster();
        fireEvent.click(list.getByRole("option", { name: /vancat/ }));
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(commitSelection).not.toHaveBeenCalled();
        expect(onEffortChange).not.toHaveBeenCalled();
      });

      it("applies an effort-only pin to the model already drafted", async () => {
        const onEffortChange = jest.fn();
        renderWithAgents([COPILOT, { slug: "vancat", modelKey: null, effort: "low" }], {
          onEffortChange,
        });

        const list = await openRoster();
        fireEvent.click(list.getByRole("option", { name: /vancat/ }));
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(onEffortChange).toHaveBeenCalledWith("low");
      });

      it.each([
        [6, false],
        [7, true],
      ])(
        "offers a search field for a roster of %i entries: %p (designdocs/CUSTOM_AGENTS.md §3)",
        async (count, expected) => {
          renderWithAgents(roster(count - 1));

          await openRoster();

          expect(Boolean(screen.queryByPlaceholderText("Search agents..."))).toBe(expected);
        }
      );

      it("narrows the roster to the agents whose name or description matches the search", async () => {
        renderWithAgents([...roster(6), { slug: "jennifer", modelKey: null, effort: null }]);

        const list = await openRoster();
        fireEvent.change(screen.getByPlaceholderText("Search agents..."), {
          target: { value: "JENNIFER desc" },
        });

        expect(list.getAllByRole("option").map((row) => row.textContent)).toEqual([
          "🪶jenniferjennifer description",
        ]);
      });

      it("says so when the search matches nobody", async () => {
        renderWithAgents(roster(7));

        await openRoster();
        fireEvent.change(screen.getByPlaceholderText("Search agents..."), {
          target: { value: "nobody" },
        });

        expect(screen.getByText("No matching agents")).toBeTruthy();
      });

      it("moves through the roster with the arrow keys and picks with Enter, leaving the model draft alone", async () => {
        const onSelect = jest.fn();
        const commitSelection = jest.fn();
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: null, effort: null }], {
          onSelect,
          commitSelection,
        });

        const list = await openRoster();
        const roster0 = list.getAllByRole("option")[0];
        fireEvent.keyDown(roster0, { key: "ArrowDown" });
        fireEvent.keyDown(roster0, { key: "Enter" });

        expect(onSelect).toHaveBeenCalledWith("jennifer");
        expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        // Enter reached the roster only: the model group never re-drafted.
        expect(commitSelection).not.toHaveBeenCalled();
      });

      it("opens the roster from the keyboard when the select row is activated", async () => {
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: null, effort: null }]);

        fireEvent.keyDown(await screen.findByRole("combobox", { name: "Agent" }), { key: "Enter" });

        expect(await screen.findByRole("listbox", { name: "Agent" })).toBeTruthy();
      });

      it("offers no Agent section at all when the caller supplies none, as Quick Chat does", async () => {
        render(
          <ModelEffortPicker
            override={{
              models: agentModels,
              value: "model|agent",
              effortOptionsByModelKey: effortByKey,
              commitSelection: jest.fn(),
            }}
          />
        );
        fireEvent.click(screen.getByTitle("Model · effort"));

        await screen.findByRole("listbox", { name: "Model" });
        expect(screen.queryByRole("combobox", { name: "Agent" })).toBeNull();
      });
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

    it("checks the selected agent and hovers the highlighted one", () => {
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
      expect(vancat.getAttribute("data-highlighted")).toBe("true");
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
