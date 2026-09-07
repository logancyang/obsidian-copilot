import { RelevantNotesShelfPanel } from "@/agentMode/ui/RelevantNotesShelfPanel";
import { Empty, Loading } from "@/agentMode/ui/RelevantNotesShelfPanel.stories";
import { AppContext } from "@/context";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

const hintKey = "copilot:relevant-notes-popout-hint-dismissed:v1";

describe("RelevantNotesShelfPanel", () => {
  describe("RelevantNotesShelfPanel()", () => {
    it.each(["true", "false"])(
      "keeps the pane action available after remount with saved hint dismissal %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/381)",
      (dismissed) => {
        const saved = new Map([[hintKey, dismissed]]);
        const app = {
          loadLocalStorage: (key: string) => saved.get(key) ?? null,
          saveLocalStorage: jest.fn(),
        } as unknown as App;
        const onPopOut = jest.fn();
        const panel = (
          <AppContext.Provider value={app}>
            <RelevantNotesShelfPanel onPopOut={onPopOut}>
              <span>Design principles</span>
            </RelevantNotesShelfPanel>
          </AppContext.Provider>
        );
        const firstMount = render(panel);
        fireEvent.click(screen.getByRole("button", { name: "Open in separate pane" }));
        expect(onPopOut).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "Dismiss hint" })).toBeNull();
        expect(screen.queryByText(/Open Relevant Notes in its own pane/)).toBeNull();
        expect(screen.getByText("Design principles")).toBeTruthy();

        firstMount.unmount();
        render(panel);
        expect(screen.getByRole("button", { name: "Open in separate pane" })).toBeTruthy();
        expect(saved.get(hintKey)).toBe(dismissed);
        expect(app.saveLocalStorage).not.toHaveBeenCalled();
      }
    );

    it.each([
      ["empty", Empty.args?.children, "No relevant notes found"],
      ["loading", Loading.args?.children, "Finding relevant notes…"],
    ])("retains the action with %s results", (_state, children, text) => {
      const onPopOut = jest.fn();
      render(<RelevantNotesShelfPanel onPopOut={onPopOut}>{children}</RelevantNotesShelfPanel>);
      expect(screen.getByText(text)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open in separate pane" }));
      expect(onPopOut).toHaveBeenCalledTimes(1);
    });
  });
});
