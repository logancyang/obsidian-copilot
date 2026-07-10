import { App, TFile, TFolder } from "obsidian";
import { ProjectContentTracker } from "./projectContentTracker";
import * as projectState from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/logFileManager", () => ({
  logFileManager: { getLogPath: () => "copilot/copilot-log.md" },
}));

jest.mock(
  "@/settings/model",
  (): Record<string, unknown> => ({
    ...jest.requireActual("@/settings/model"),
    getSettings: jest
      .fn()
      .mockReturnValue({ projectsFolder: "", qaInclusions: "", qaExclusions: "" }),
  })
);

jest.mock("@/projects/state", () => ({
  getCachedProjectRecords: jest.fn().mockReturnValue([]),
}));

type Handler = (file: unknown, oldPath?: string) => void;

/** A fake vault that records event handlers so a test can fire them by hand. */
function makeApp(): { app: App; fire: (event: string, file: unknown, oldPath?: string) => void } {
  const handlers = new Map<string, Handler[]>();
  const app = {
    vault: {
      on: (event: string, handler: Handler) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return { event };
      },
      offref: jest.fn(),
    },
  } as unknown as App;
  const fire = (event: string, file: unknown, oldPath?: string) => {
    for (const handler of handlers.get(event) ?? []) handler(file, oldPath);
  };
  return { app, fire };
}

function record(id: string, contextSource: Record<string, string>): ProjectFileRecord {
  return {
    project: { id, contextSource } as ProjectFileRecord["project"],
    filePath: `Projects/${id}/project.md`,
    folderName: id,
  };
}

function mockRecords(...records: ProjectFileRecord[]): void {
  (projectState.getCachedProjectRecords as jest.Mock).mockReturnValue(records);
}

function file(path: string): TFile {
  return new (TFile as unknown as new (p: string) => TFile)(path);
}

function folder(path: string): TFolder {
  return new (TFolder as unknown as new (p: string) => TFolder)(path);
}

describe("ProjectContentTracker", () => {
  afterEach(() => jest.clearAllMocks());

  it("bumps the epoch only for the project whose folder scope a file change touches", () => {
    mockRecords(record("a", { inclusions: "Notes" }), record("b", { inclusions: "Other" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("Notes/topic.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
    expect(tracker.getEpoch("b")).toBe(0);
    tracker.dispose();
  });

  it("notifies subscribers with the affected project id", () => {
    mockRecords(record("a", { inclusions: "Notes" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);
    const seen: string[] = [];
    tracker.onContentChanged((id) => seen.push(id));

    fire("create", file("Notes/new.md"));
    tracker.flushNow();

    expect(seen).toEqual(["a"]);
    tracker.dispose();
  });

  it("matches a deleted file by its (dead) path", () => {
    mockRecords(record("a", { inclusions: "Notes" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("delete", file("Notes/gone.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
    tracker.dispose();
  });

  it("matches a rename on BOTH the old and the new path", () => {
    mockRecords(record("in", { inclusions: "Notes" }), record("out", { inclusions: "Archive" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    // Moved from Archive (out's scope) into Notes (in's scope): both dirty.
    fire("rename", file("Notes/moved.md"), "Archive/moved.md");
    tracker.flushNow();

    expect(tracker.getEpoch("in")).toBe(1);
    expect(tracker.getEpoch("out")).toBe(1);
    tracker.dispose();
  });

  it("dirties a folder-inclusion project on an ANCESTOR folder rename", () => {
    mockRecords(record("a", { inclusions: "Notes/Sub" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    // Renaming the ancestor `Notes` moves the included `Notes/Sub` subtree.
    fire("rename", folder("Renamed"), "Notes");
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
    tracker.dispose();
  });

  it("conservatively dirties a tag-declaring project on ANY markdown change", () => {
    // The changed file isn't under any folder pattern, but the project declares a
    // tag, and tags can't be resolved from a path — so it dirties conservatively.
    mockRecords(record("a", { inclusions: "#important" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("Anywhere/note.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
    tracker.dispose();
  });

  it("does NOT dirty a tag-declaring project on a non-markdown change out of scope", () => {
    mockRecords(record("a", { inclusions: "#important" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("Anywhere/image.png"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(0);
    tracker.dispose();
  });

  it("ignores an internal Copilot file caught by a broad *.md pattern", () => {
    mockRecords(record("a", { inclusions: "*.md" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("copilot/copilot-log.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(0);
    tracker.dispose();
  });

  it("flushNow drains synchronously and does not double-bump on a later timer", () => {
    jest.useFakeTimers();
    mockRecords(record("a", { inclusions: "Notes" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("Notes/topic.md"));
    tracker.flushNow();
    expect(tracker.getEpoch("a")).toBe(1);

    // The debounce timer must have been cleared by flush — no second bump.
    jest.runOnlyPendingTimers();
    expect(tracker.getEpoch("a")).toBe(1);

    tracker.dispose();
    jest.useRealTimers();
  });

  it("a matcher throw for one project doesn't stop the sweep for others", () => {
    // First record has a getter that throws when its contextSource is read.
    const boom = {
      project: {
        id: "boom",
        get contextSource() {
          throw new Error("bad pattern");
        },
      },
      filePath: "Projects/boom/project.md",
      folderName: "boom",
    } as unknown as ProjectFileRecord;
    mockRecords(boom, record("ok", { inclusions: "Notes" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("Notes/topic.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("ok")).toBe(1);
    tracker.dispose();
  });

  it("stops bumping after dispose", () => {
    mockRecords(record("a", { inclusions: "Notes" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);
    tracker.dispose();

    fire("modify", file("Notes/topic.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(0);
  });
});
