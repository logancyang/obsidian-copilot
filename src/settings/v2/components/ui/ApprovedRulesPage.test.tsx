import type { ApprovedRule, ApprovedRuleStore } from "@/agentMode";
import type CopilotPlugin from "@/main";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { ApprovedRulesPage } from "./ApprovedRulesPage";

const PLUGIN = {} as CopilotPlugin;

const GIT_STATUS: ApprovedRule = {
  id: "rule-git",
  allows: "Bash(git status:*)",
  appliesTo: { kind: "agent" },
};
const NPM_TEST: ApprovedRule = {
  id: "rule-npm",
  allows: "Bash(npm run test:*)",
  appliesTo: { kind: "folder", path: "/Users/me/vault" },
};
const WEB_FETCH: ApprovedRule = {
  id: "rule-fetch",
  allows: "WebFetch(domain:docs.obsidian.md)",
  appliesTo: { kind: "file", path: "/Users/me/vault/.claude/settings.local.json" },
};

function makeStore(rules: ReadonlyArray<ApprovedRule>): jest.Mocked<ApprovedRuleStore> {
  return {
    list: jest.fn().mockResolvedValue(rules),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

function renderPage(store: ApprovedRuleStore, onBack: () => void = jest.fn()) {
  return render(
    <ApprovedRulesPage agentName="Claude" store={store} plugin={PLUGIN} onBack={onBack} />
  );
}

function ruleRows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Approved rules" })).getAllByRole("listitem");
}

describe("ApprovedRulesPage", () => {
  describe("ApprovedRulesPage()", () => {
    it("shows a loading message until the agent's rules arrive, then lists what each rule allows and where it applies", async () => {
      let resolveList: (rules: ReadonlyArray<ApprovedRule>) => void = () => undefined;
      const store = makeStore([]);
      store.list.mockReturnValue(
        new Promise((resolve) => {
          resolveList = resolve;
        })
      );

      renderPage(store);

      expect(screen.getByText("Loading approved rules…")).not.toBeNull();
      expect(store.list).toHaveBeenCalledWith(PLUGIN);

      await act(async () => resolveList([GIT_STATUS, NPM_TEST, WEB_FETCH]));

      expect(screen.queryByText("Loading approved rules…")).toBeNull();
      expect(ruleRows().map((row) => row.textContent)).toEqual([
        expect.stringContaining("Bash(git status:*)All Claude chats"),
        expect.stringContaining("Bash(npm run test:*)Chats in /Users/me/vault"),
        expect.stringContaining(
          "WebFetch(domain:docs.obsidian.md)Saved in /Users/me/vault/.claude/settings.local.json"
        ),
      ]);
    });

    it("narrows the list to rules whose allowed action or location contains the search text, ignoring case", async () => {
      renderPage(makeStore([GIT_STATUS, NPM_TEST, WEB_FETCH]));
      await screen.findByText("Bash(git status:*)");

      fireEvent.change(screen.getByPlaceholderText("Search approved rules…"), {
        target: { value: "NPM" },
      });
      expect(ruleRows().map((row) => row.textContent)).toEqual([
        expect.stringContaining("Bash(npm run test:*)"),
      ]);

      fireEvent.change(screen.getByPlaceholderText("Search approved rules…"), {
        target: { value: "settings.local" },
      });
      expect(ruleRows().map((row) => row.textContent)).toEqual([
        expect.stringContaining("WebFetch(domain:docs.obsidian.md)"),
      ]);
    });

    it("says no rule matches when the search text matches nothing", async () => {
      renderPage(makeStore([GIT_STATUS]));
      await screen.findByText("Bash(git status:*)");

      fireEvent.change(screen.getByPlaceholderText("Search approved rules…"), {
        target: { value: "curl" },
      });

      expect(screen.getByText("No rules match “curl”.")).not.toBeNull();
      expect(screen.queryByRole("list", { name: "Approved rules" })).toBeNull();
    });

    it("says the agent has no approved rules when its store lists none", async () => {
      renderPage(makeStore([]));

      expect(await screen.findByText("Claude has no approved rules.")).not.toBeNull();
      expect(screen.queryByPlaceholderText("Search approved rules…")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/865 reports that the rules can't be read, with the error, instead of showing an empty list", async () => {
      const store = makeStore([]);
      store.list.mockRejectedValue(new Error("EACCES: permission denied, open 'settings.json'"));

      renderPage(store);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Couldn't read Claude's approved rules.");
      expect(alert.textContent).toContain("EACCES: permission denied, open 'settings.json'");
      expect(screen.queryByText("Claude has no approved rules.")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/865 disables every Remove while one removal is in progress, then drops the removed rule from the list", async () => {
      let finishRemove: () => void = () => undefined;
      const store = makeStore([GIT_STATUS, NPM_TEST]);
      store.remove.mockReturnValue(
        new Promise<void>((resolve) => {
          finishRemove = resolve;
        })
      );
      renderPage(store);
      await screen.findByText("Bash(git status:*)");

      fireEvent.click(within(ruleRows()[0]).getByRole("button", { name: "Remove" }));

      expect(store.remove).toHaveBeenCalledWith(PLUGIN, GIT_STATUS);
      expect(
        screen.getAllByRole("button", { name: "Remove" }).map((b) => b.hasAttribute("disabled"))
      ).toEqual([true, true]);

      await act(async () => finishRemove());

      expect(screen.queryByText("Bash(git status:*)")).toBeNull();
      expect(ruleRows()).toHaveLength(1);
      expect(
        within(ruleRows()[0]).getByRole("button", { name: "Remove" }).hasAttribute("disabled")
      ).toBe(false);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/865 keeps a rule listed and shows the error when the agent's store fails to remove it", async () => {
      const store = makeStore([GIT_STATUS, NPM_TEST]);
      store.remove.mockRejectedValue(new Error("settings.json is read-only"));
      renderPage(store);
      await screen.findByText("Bash(git status:*)");

      await act(async () => {
        fireEvent.click(within(ruleRows()[0]).getByRole("button", { name: "Remove" }));
      });

      expect(ruleRows()).toHaveLength(2);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Couldn't remove Bash(git status:*).");
      expect(alert.textContent).toContain("settings.json is read-only");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/865 focuses Back when the page opens, so the page starts in view even when it replaces settings far down a scrolled tab", async () => {
      renderPage(makeStore([GIT_STATUS]));
      await screen.findByText("Bash(git status:*)");

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
    });

    it("returns to the agent's settings when Back is selected", async () => {
      const onBack = jest.fn();
      renderPage(makeStore([GIT_STATUS]), onBack);
      await screen.findByText("Bash(git status:*)");

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });
});
