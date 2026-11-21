import {
  MemorySaveLines,
  memorySaveCardKind,
  memorySaveTrail,
  openAgentFile,
  openMemoryRule,
} from "@/agents/agentMode/memorySaveCards";
import type { AgentChatMessage, AgentMessagePart } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { TFile, type App } from "obsidian";
import React from "react";

const ISSUE_988 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/988";
const MEMORY = "copilot/teammates/coco/MEMORY.md";
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

function saveCall(id: string, rule: string, call: { code: string } | null = null): ToolCallPart {
  return {
    kind: "tool_call",
    id,
    title: "save_memory",
    status: "completed",
    mcpServer: "obsidian-copilot",
    copilotTools: {
      calls: [
        call
          ? { name: "save_memory", ...call }
          : { name: "save_memory", args: { rule, why: "Asked" } },
      ],
    },
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
    it(`places each save at the save_memory call that made it, the last one with its rule after a turned-down try (${ISSUE_988})`, () => {
      const other = { ...SAVE, rule: "Taxes go to Leo." };
      const parts = [
        saveCall("refused", RULE),
        edit("note", "notes/plan.md"),
        saveCall("saved", ` ${RULE}\n`),
        saveCall("other", other.rule),
      ];

      expect(memorySaveTrail(reply({ parts, memorySaves: [SAVE, other] }))).toEqual({
        saves: [SAVE, other],
        byCall: new Map([
          ["saved", [SAVE]],
          ["other", [other]],
        ]),
        unplaced: [],
      });
    });

    it(`reads the rule from a save_memory call Codex wrote as code (${ISSUE_988})`, () => {
      const parts = [saveCall("code", RULE, { code: `save_memory({ rule: "${RULE}" })` })];

      expect(memorySaveTrail(reply({ parts, memorySaves: [SAVE] }))?.byCall).toEqual(
        new Map([["code", [SAVE]]])
      );
    });

    it(`leaves a save from a chat saved before the tool existed unplaced, to be drawn at the top of its reply, since the agent then edited MEMORY.md itself (${ISSUE_988})`, () => {
      const parts = [edit("other", "notes/plan.md"), edit("save", `/vault/${MEMORY}`)];

      expect(memorySaveTrail(reply({ parts, memorySaves: [SAVE] }))).toEqual({
        saves: [SAVE],
        byCall: new Map(),
        unplaced: [SAVE],
      });
    });

    it("leaves every save unplaced for a reply opened from its note, which has no tool calls", () => {
      expect(memorySaveTrail(reply({ memorySaves: [SAVE] }))).toEqual({
        saves: [SAVE],
        byCall: new Map(),
        unplaced: [SAVE],
      });
    });

    it(`returns nothing for a reply that saved no rule, even one whose save_memory call was turned down (${ISSUE_988})`, () => {
      expect(memorySaveTrail(reply({ parts: [saveCall("refused", RULE)] }))).toBeNull();
    });
  });

  describe("openAgentFile()", () => {
    it("opens an agent's file at the top in a new tab of the main editor area", async () => {
      const { app, memory, newLeaf, raw } = fakeApp();

      await openAgentFile(app, MEMORY);

      expect(raw.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(newLeaf.openFile).toHaveBeenCalledWith(memory, { active: true, eState: undefined });
    });

    it("switches to the tab where the file is already open instead of opening another", async () => {
      const { app, openFile, raw } = fakeApp([MEMORY]);

      await openAgentFile(app, MEMORY);

      expect(openFile).toHaveBeenCalledTimes(1);
      expect(raw.workspace.getLeaf).not.toHaveBeenCalled();
    });

    it("does nothing for a file that is gone", async () => {
      const { app, newLeaf } = fakeApp();

      await openAgentFile(app, "copilot/teammates/gone/instructions.md");

      expect(newLeaf.openFile).not.toHaveBeenCalled();
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

      await openMemoryRule(app, "copilot/teammates/gone/MEMORY.md", RULE);

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
        "copilot/teammates/coco/instructions.md",
        "",
        "tab"
      );
    });
  });

  describe("memorySaveCardKind", () => {
    it(`claims only the calls a save was placed at, and draws that call's saves in its place (${ISSUE_988})`, () => {
      const { app } = fakeApp();
      const memorySaves = { saves: [SAVE], byCall: new Map([["saved", [SAVE]]]), unplaced: [] };
      const ctx = { tasks: null, memorySaves };

      expect(memorySaveCardKind.place(saveCall("saved", RULE), ctx)).toEqual({ joinKey: null });
      expect(memorySaveCardKind.place(saveCall("refused", RULE), ctx)).toBeNull();
      expect(memorySaveCardKind.place(saveCall("saved", RULE), { tasks: null })).toBeNull();
      render(
        <>
          {memorySaveCardKind.render([saveCall("saved", RULE)], {
            ...ctx,
            app,
            open: false,
            onToggle: () => {},
            renderCall: () => null,
          })}
        </>
      );
      expect(screen.getByText("Coco remembered")).toBeTruthy();
      expect(screen.getByText(`“${RULE}”`)).toBeTruthy();
    });
  });
});
