jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  MarkdownView: class MarkdownView {},
}));

import { EditorSelection, EditorState, type StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Component, MarkdownView, type App } from "obsidian";

import type { QuickAskHost, QuickAskWidgetPayload } from "@/components/quick-ask/types";
import { QuickAskController } from "@/editor/quickAskController";
import { quickAskWidgetEffect } from "@/editor/quickAskExtension";

const NOTE_TEXT = "She go to school yesterday.";

function openNote(): { markdownView: MarkdownView; editor: EditorView } {
  const editor = new EditorView({
    state: EditorState.create({ doc: NOTE_TEXT, selection: EditorSelection.single(4, 6) }),
    parent: window.document.createElement("div"),
  });
  const markdownView = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    editor: { cm: editor },
    leaf: {},
    file: { path: "Essay.md" },
  });
  return { markdownView, editor };
}

function shownPayloads(dispatch: jest.SpyInstance): QuickAskWidgetPayload[] {
  return dispatch.mock.calls.flatMap(([spec]: [{ effects?: StateEffect<unknown>[] }]) =>
    (spec.effects ?? []).flatMap((effect) =>
      effect.is(quickAskWidgetEffect) && effect.value ? [effect.value] : []
    )
  );
}

describe("quickAskController", () => {
  describe("QuickAskController", () => {
    describe("show()", () => {
      it("opens Quick Ask on the selected text with the host the controller was built with", () => {
        const host = Object.assign(new Component(), { app: {} as App }) as QuickAskHost;
        const { markdownView, editor } = openNote();
        const dispatch = jest.spyOn(editor, "dispatch");

        new QuickAskController(host).show(markdownView, editor);

        const [{ options }] = shownPayloads(dispatch);
        expect(options.host).toBe(host);
        expect(options.view).toBe(editor);
        expect([options.selectedText, options.selectionFrom, options.selectionTo]).toEqual([
          "go",
          4,
          6,
        ]);
        editor.destroy();
      });
    });
  });
});
