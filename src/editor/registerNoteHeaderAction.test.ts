jest.mock("obsidian", () => ({
  MarkdownView: class MarkdownView {},
  TFile: class TFile {},
}));

import type CopilotPlugin from "@/main";
import { registerNoteHeaderAction } from "@/editor/registerNoteHeaderAction";
import { COPILOT_AGENT_ICON_ID } from "@/constants";
import { MarkdownView, TFile, type WorkspaceLeaf } from "obsidian";

interface NoteView extends MarkdownView {
  addAction: jest.Mock;
  file: TFile;
}

function noteView(path: string): NoteView {
  const view = Object.create(MarkdownView.prototype) as NoteView;
  const header = document.createElement("div");
  view.file = Object.assign(new TFile(), { path });
  view.addAction = jest.fn((icon: string, title: string, callback: () => void) => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", title);
    button.dataset.icon = icon;
    button.addEventListener("click", callback);
    header.append(button);
    document.body.append(header);
    return button;
  });
  return view;
}

function fixture(views: NoteView[]) {
  const listeners = new Map<string, () => void>();
  let layoutReady: () => void = () => undefined;
  let cleanup: () => void = () => undefined;
  const addNoteToAgentChat = jest.fn().mockResolvedValue(undefined);
  const workspace = {
    getLeavesOfType: jest.fn(() => views.map((view) => ({ view }) as unknown as WorkspaceLeaf)),
    onLayoutReady: jest.fn((callback: () => void) => {
      layoutReady = callback;
    }),
    on: jest.fn((event: string, callback: () => void) => {
      listeners.set(event, callback);
      return {};
    }),
  };
  const plugin = {
    app: { workspace },
    addNoteToAgentChat,
    registerEvent: jest.fn(),
    register: jest.fn((callback: () => void) => {
      cleanup = callback;
    }),
  } as unknown as CopilotPlugin;
  return {
    plugin,
    workspace,
    listeners,
    layoutReady: () => layoutReady(),
    cleanup: () => cleanup(),
    addNoteToAgentChat,
  };
}

describe("registerNoteHeaderAction", () => {
  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 adds a Copilot action to every open note and passes the clicked view's current file", () => {
    const research = noteView("Research.md");
    const journal = noteView("Journal.md");
    const { plugin, layoutReady, addNoteToAgentChat } = fixture([research, journal]);

    registerNoteHeaderAction(plugin);
    layoutReady();
    const button = research.addAction.mock.results[0].value as HTMLButtonElement;
    expect(button.dataset.icon).toBe(COPILOT_AGENT_ICON_ID);
    expect(button.getAttribute("aria-label")).toBe("Open Copilot Agent Chat with this note");

    research.file = Object.assign(new TFile(), { path: "Reused tab.md" });
    button.click();
    expect(addNoteToAgentChat).toHaveBeenCalledWith(research.file, true);
    expect(journal.addAction).toHaveBeenCalledTimes(1);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 adds an action once per note leaf, including leaves opened later, and removes them on unload", () => {
    const first = noteView("First.md");
    const views = [first];
    const { plugin, layoutReady, listeners, cleanup } = fixture(views);

    registerNoteHeaderAction(plugin);
    layoutReady();
    listeners.get("layout-change")!();
    expect(first.addAction).toHaveBeenCalledTimes(1);

    const second = noteView("Second.md");
    views.push(second);
    listeners.get("layout-change")!();
    expect(second.addAction).toHaveBeenCalledTimes(1);

    cleanup();
    expect((first.addAction.mock.results[0].value as HTMLElement).isConnected).toBe(false);
    expect((second.addAction.mock.results[0].value as HTMLElement).isConnected).toBe(false);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 leaves Agent Chat closed when the clicked Markdown view has no note", () => {
    const view = noteView("Research.md");
    const { plugin, layoutReady, addNoteToAgentChat } = fixture([view]);

    registerNoteHeaderAction(plugin);
    layoutReady();
    Object.assign(view, { file: null });
    (view.addAction.mock.results[0].value as HTMLButtonElement).click();

    expect(addNoteToAgentChat).not.toHaveBeenCalled();
  });
});
