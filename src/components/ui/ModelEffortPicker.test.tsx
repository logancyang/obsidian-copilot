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

    it.each([
      { picked: false, expected: undefined },
      { picked: true, expected: ["model|agent", null] },
    ])(
      "with no model selected yet, commits the first row only once it is picked: picked=$picked (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)",
      async ({ picked, expected }) => {
        const commitSelection = jest.fn();
        render(
          <ModelEffortPicker
            override={{
              models: [...models, { name: "other", provider: "agent", enabled: true }],
              value: "",
              effortOptionsByModelKey: {},
              commitSelection,
            }}
          />
        );
        fireEvent.click(screen.getByTitle("Model · effort"));
        const dialog = await screen.findByRole("dialog");
        if (picked) fireEvent.click(screen.getByRole("option", { name: /^model/ }));
        fireEvent.keyDown(dialog, { key: "Escape" });
        if (expected) expect(commitSelection).toHaveBeenCalledWith(...expected);
        else expect(commitSelection).not.toHaveBeenCalled();
      }
    );

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
          "https://www.obsidiancopilot.com/pricing?utm_source=obsidian_copilot&utm_medium=model_picker_lock"
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
  });
});
