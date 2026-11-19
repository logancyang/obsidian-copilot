import {
  MemorySaveLines,
  memorySaveCardKind,
  memorySaveTrail,
  openMemoryRule,
} from "@/agents/agentMode/memorySaveCards";
import type { AgentChatMessage, AgentMessagePart } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { TFile, type App } from "obsidian";
import React from "react";

const MEMORY = "copilot/agents/coco/MEMORY.md";
const RULE = "Launch videos lead with user value, not the feature list.";
const SAVE = { agentName: "Coco", memoryPath: MEMORY, rule: RULE };
const MEMORY_TEXT = `## How to work\n\nWrite dates as Nov 16.\n2026-10-30 · Asked\n\n${RULE}\n2026-11-16 · Asked\n`;

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;

function edit(id: string, path: string, overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    kind: "tool_call",
    id,
    title: id,
    status: "completed",
    toolKind: "edit",
    locations: [{ path }],
    ...overrides,
  };
}

function reply(overrides: Partial<AgentChatMessage>): AgentChatMessage {
  return {
    id: "reply",
    sender: "AI",
    message: "Got it.",
    timestamp: null,
    isVisible: true,
    ...overrides,
  };
}

function fakeApp(openPaths: string[] = []) {
  const memory = Object.assign(new TFile(), { path: MEMORY });
  const openFile = jest.fn().mockResolvedValue(undefined);
  const openLeaves = openPaths.map((file) => ({
    getViewState: () => ({ state: { file } }),
    openFile,
  }));
  const newLeaf = { openFile: jest.fn().mockResolvedValue(undefined) };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (path === MEMORY ? memory : null),
      cachedRead: jest.fn().mockResolvedValue(MEMORY_TEXT),
    },
    workspace: {
      getLeavesOfType: jest.fn(() => openLeaves),
      getLeaf: jest.fn(() => newLeaf),
      openLinkText: jest.fn(),
    },
    metadataCache: { getFirstLinkpathDest: jest.fn(() => null) },
  };
  return { app: app as unknown as App, memory, openFile, newLeaf, raw: app };
}

describe("memorySaveCards", () => {
  describe("memorySaveTrail()", () => {
    it("anchors the saves at the edit of the agent's MEMORY.md, so they stand in for it", () => {
      const parts = [edit("other", "notes/plan.md"), edit("save", `/vault/${MEMORY}`)];

      expect(memorySaveTrail(reply({ parts, memorySaves: [SAVE] }), "/vault")).toEqual({
        saves: [SAVE],
        anchorId: "save",
      });
    });

    it("anchors nowhere when the edit that wrote MEMORY.md also edited another note, so that note's edit card stays in the trail (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", () => {
      const parts = [
        edit("patch", `/vault/${MEMORY}`, {
          locations: [{ path: `/vault/${MEMORY}` }, { path: "/vault/notes/plan.md" }],
        }),
      ];

      expect(memorySaveTrail(reply({ parts, memorySaves: [SAVE] }), "/vault")).toEqual({
        saves: [SAVE],
        anchorId: null,
      });
    });

    it("anchors nowhere for a reply opened from its note, which has no tool calls", () => {
      expect(memorySaveTrail(reply({ memorySaves: [SAVE] }), "/vault")).toEqual({
        saves: [SAVE],
        anchorId: null,
      });
    });

    it("returns nothing for a reply that saved no rule", () => {
      expect(memorySaveTrail(reply({ parts: [edit("save", MEMORY)] }), "/vault")).toBeNull();
    });
  });

  describe("openMemoryRule()", () => {
    it("opens MEMORY.md in a new tab, scrolled to the saved rule with the rule selected (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", async () => {
      const { app, memory, newLeaf } = fakeApp();

      await openMemoryRule(app, MEMORY, RULE);

      expect(newLeaf.openFile).toHaveBeenCalledWith(memory, {
        active: true,
        eState: {
          scroll: 5,
          cursor: { from: { line: 5, ch: 0 }, to: { line: 5, ch: RULE.length } },
        },
      });
    });

    it("switches to the tab where MEMORY.md is already open instead of opening another", async () => {
      const { app, openFile, raw } = fakeApp([MEMORY]);

      await openMemoryRule(app, MEMORY, RULE);

      expect(openFile).toHaveBeenCalledTimes(1);
      expect(raw.workspace.getLeaf).not.toHaveBeenCalled();
    });

    it("opens MEMORY.md at the top once the rule was edited away", async () => {
      const { app, memory, newLeaf } = fakeApp();

      await openMemoryRule(app, MEMORY, "A rule the user since deleted.");

      expect(newLeaf.openFile).toHaveBeenCalledWith(memory, { active: true, eState: undefined });
    });

    it("does nothing once MEMORY.md is gone", async () => {
      const { app, newLeaf } = fakeApp();

      await openMemoryRule(app, "copilot/agents/gone/MEMORY.md", RULE);

      expect(newLeaf.openFile).not.toHaveBeenCalled();
    });
  });

  describe("MemorySaveLines", () => {
    it("shows one line per saved rule and opens the agent's instructions.md from a warning's link", () => {
      const { app, raw } = fakeApp();
      render(
        <MemorySaveLines
          app={app}
          saves={[SAVE, { ...SAVE, rule: "Taxes go to Leo.", contradicts: "File taxes." }]}
        />
      );

      expect(screen.getAllByText("Coco remembered")).toHaveLength(2);
      fireEvent.click(screen.getByText("Open instruction"));

      expect(raw.workspace.openLinkText).toHaveBeenCalledWith(
        "copilot/agents/coco/instructions.md",
        "",
        "tab"
      );
    });
  });

  describe("memorySaveCardKind", () => {
    it("claims only the edit its message's saves are anchored at", () => {
      const ctx = { tasks: null, memorySaves: { saves: [SAVE], anchorId: "save" } };

      expect(memorySaveCardKind.place(edit("save", MEMORY), ctx)).toEqual({ joinKey: null });
      expect(memorySaveCardKind.place(edit("again", MEMORY), ctx)).toBeNull();
      expect(memorySaveCardKind.place(edit("save", MEMORY), { tasks: null })).toBeNull();
    });
  });
});
