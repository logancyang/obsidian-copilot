import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { ModelEffortPicker } from "./ModelEffortPicker";

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
        icon: "\u2726",
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
        render(
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
                  icon: "\ud83e\udeb6",
                  description: `${row.slug} description`,
                  ...row,
                })),
                selectedSlug: "copilot",
                onSelect: handlers.onSelect ?? jest.fn(),
                onOpen: handlers.onOpen,
              },
            }}
          />
        );
        fireEvent.click(screen.getByTitle("Model \u00b7 effort"));
      }

      it("lists the roster above the model group, with the selected agent checked", async () => {
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: null, effort: null }]);

        const agentBox = await screen.findByRole("listbox", { name: "Agent" });
        const modelBox = screen.getByRole("listbox", { name: "Model" });
        expect(
          agentBox.compareDocumentPosition(modelBox) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        const section = within(agentBox);
        expect(section.getAllByRole("option").map((row) => row.textContent)).toEqual([
          "\u2713\u2726CopilotYour vault instructions, no persona, no memory.",
          "\ud83e\udeb6jenniferjennifer description",
        ]);
      });

      it("re-reads the roster as the popover opens, so an agent just created is offered", () => {
        const onOpen = jest.fn();
        renderWithAgents([COPILOT], { onOpen });

        expect(onOpen).toHaveBeenCalledTimes(1);
      });

      it("drafts the pinned model and effort of the agent picked, and commits both on dismiss (designdocs/CUSTOM_AGENTS.md \u00a73)", async () => {
        const onSelect = jest.fn();
        const commitSelection = jest.fn();
        renderWithAgents([COPILOT, { slug: "jennifer", modelKey: "other|agent", effort: "low" }], {
          onSelect,
          commitSelection,
        });

        fireEvent.click(await screen.findByRole("option", { name: /jennifer/ }));

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

        fireEvent.click(await screen.findByRole("option", { name: /vancat/ }));
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(commitSelection).not.toHaveBeenCalled();
        expect(onEffortChange).not.toHaveBeenCalled();
      });

      it("applies an effort-only pin to the model already drafted", async () => {
        const onEffortChange = jest.fn();
        renderWithAgents([COPILOT, { slug: "vancat", modelKey: null, effort: "low" }], {
          onEffortChange,
        });

        fireEvent.click(await screen.findByRole("option", { name: /vancat/ }));
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(onEffortChange).toHaveBeenCalledWith("low");
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
        fireEvent.click(screen.getByTitle("Model \u00b7 effort"));

        await screen.findByRole("listbox", { name: "Model" });
        expect(screen.queryByRole("listbox", { name: "Agent" })).toBeNull();
      });
    });
  });
});
