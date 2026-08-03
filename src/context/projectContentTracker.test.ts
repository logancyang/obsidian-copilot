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

/** A fake vault + metadata cache that record event handlers so a test can fire
 * them by hand. Vault and metadata cache use separate `offref` mocks so a test can
 * assert teardown routes each ref to its own emitter. */
function makeApp(): {
  app: App;
  fire: (event: string, file: unknown, oldPath?: string) => void;
  vaultOffref: jest.Mock;
  metadataOffref: jest.Mock;
} {
  const handlers = new Map<string, Handler[]>();
  const register = (event: string, handler: Handler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return { event };
  };
  const vaultOffref = jest.fn();
  const metadataOffref = jest.fn();
  const app = {
    vault: { on: register, offref: vaultOffref },
    metadataCache: { on: register, offref: metadataOffref },
  } as unknown as App;
  const fire = (event: string, file: unknown, oldPath?: string) => {
    for (const handler of handlers.get(event) ?? []) handler(file, oldPath);
  };
  return { app, fire, vaultOffref, metadataOffref };
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

  it("conservatively dirties a property-declaring project on ANY markdown change (frontmatter is unresolvable from a path)", () => {
    // Editing a note's frontmatter is a plain markdown modify; the changed file is
    // out of any folder scope, but the project includes notes by a property whose
    // value can't be read from the path — so it dirties conservatively, like a tag.
    mockRecords(record("a", { inclusions: "[Topics:Physics]" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("Anywhere/note.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
    tracker.dispose();
  });

  it("does NOT dirty a property-declaring project on a non-markdown change out of scope", () => {
    mockRecords(record("a", { inclusions: "[Topics:Physics]" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("Anywhere/image.png"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(0);
    tracker.dispose();
  });

  it("does NOT dirty a property-declaring project on a markdown change under a system Copilot root", () => {
    // The vault `modify` half of the same rule the metadata event follows: a note
    // under the Copilot root (chat autosave, on by default) is dropped by
    // `shouldIndexFile`, so it can never enter a property source's note set.
    mockRecords(record("a", { inclusions: "[Topics:Physics]" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("copilot/copilot-conversations/chat.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(0);
    tracker.dispose();
  });

  it("still dirties a TAG-declaring project under a system Copilot root (tag scope is unchanged)", () => {
    // The system-root skip is property-specific; tags keep their pre-existing
    // broader rule, so this must not regress when the two predicates split.
    mockRecords(record("a", { inclusions: "#physics" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("copilot/copilot-conversations/chat.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
    tracker.dispose();
  });

  it("conservatively dirties a project declaring a property EXCLUSION on a markdown change out of folder scope", () => {
    // A note inside the included folder can flip its excluded status when its
    // frontmatter changes; the change fires for a note OUTSIDE the folder, yet the
    // property exclusion still forces a conservative dirty (over-dirty is safe).
    mockRecords(record("a", { inclusions: "Notes", exclusions: "[Draft:true]" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("modify", file("Anywhere/note.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
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

  it("dirties a tag-declaring project on a FOLDER delete (tagged notes may be inside)", () => {
    mockRecords(record("a", { inclusions: "#important" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("delete", folder("SomeFolder"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
    tracker.dispose();
  });

  it("dirties a tag-declaring project when a note LEAVES markdown scope (.md → .txt)", () => {
    mockRecords(record("a", { inclusions: "#important" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    // New file is .txt (not markdown), but the old path was .md — it left tag scope.
    fire("rename", file("Notes/note.txt"), "Notes/note.md");
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
    tracker.dispose();
  });

  it("does NOT let an internal markdown file dirty a tag-declaring project", () => {
    mockRecords(record("a", { inclusions: "#important" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    // Editing the internal log (a markdown file) must not spray tag-project notes.
    fire("modify", file("copilot/copilot-log.md"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(0);
    tracker.dispose();
  });

  it("does NOT dirty on a folder CREATE that is a DESCENDANT of a declared folder", () => {
    // The declared root `Notes` already exists, so a child folder appearing under
    // it doesn't change how the root resolves — no manifest change, no dirty.
    mockRecords(
      record("tag", { inclusions: "#important" }),
      record("folder", { inclusions: "Notes" })
    );
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("create", folder("Notes/NewEmpty"));
    tracker.flushNow();

    expect(tracker.getEpoch("tag")).toBe(0);
    expect(tracker.getEpoch("folder")).toBe(0);
    tracker.dispose();
  });

  it("dirties when a folder CREATE IS an exactly-declared folder pattern", () => {
    // A project declares `External` (out of its folder), which didn't exist. Once
    // created, resolveFolderPaths turns it into a real manifest entry + search root,
    // so a stale empty landing must not be reused.
    mockRecords(record("a", { inclusions: "External" }));
    const { app, fire } = makeApp();
    const tracker = new ProjectContentTracker(app);

    fire("create", folder("External"));
    tracker.flushNow();

    expect(tracker.getEpoch("a")).toBe(1);
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

  describe("metadata-cache (property freshness)", () => {
    it("re-dirties a property-inclusion project on a metadata change once the cache is fresh", () => {
      mockRecords(record("p", { inclusions: "[Topics:Physics]" }));
      const { app, fire } = makeApp();
      const tracker = new ProjectContentTracker(app);

      // A frontmatter edit fires vault `modify` first (cache still stale), then the
      // metadata cache `changed` once it has re-parsed. Flushing between them (as a
      // send/open would) lands each in its own drain; the SECOND bump is the one that
      // re-resolves the property source against fresh frontmatter.
      fire("modify", file("Notes/a.md"));
      tracker.flushNow();
      fire("changed", file("Notes/a.md"));
      tracker.flushNow();

      expect(tracker.getEpoch("p")).toBe(2);
      tracker.dispose();
    });

    it("collapses a modify and its metadata change in one debounce window to a single bump", () => {
      mockRecords(record("p", { inclusions: "[Topics:Physics]" }));
      const { app, fire } = makeApp();
      const tracker = new ProjectContentTracker(app);

      fire("modify", file("Notes/a.md"));
      fire("changed", file("Notes/a.md"));
      tracker.flushNow();

      expect(tracker.getEpoch("p")).toBe(1);
      tracker.dispose();
    });

    it("ignores a metadata change for projects that declare no property inclusion", () => {
      mockRecords(
        record("folderProj", { inclusions: "Notes" }),
        record("tagProj", { inclusions: "#physics" }),
        record("propProj", { inclusions: "[Topics:Physics]" })
      );
      const { app, fire } = makeApp();
      const tracker = new ProjectContentTracker(app);

      fire("changed", file("Notes/a.md"));
      tracker.flushNow();

      expect(tracker.getEpoch("folderProj")).toBe(0);
      expect(tracker.getEpoch("tagProj")).toBe(0);
      expect(tracker.getEpoch("propProj")).toBe(1);
      tracker.dispose();
    });

    it("ignores a metadata change on an internal Copilot file", () => {
      mockRecords(record("p", { inclusions: "[Topics:Physics]" }));
      const { app, fire } = makeApp();
      const tracker = new ProjectContentTracker(app);

      fire("changed", file("copilot/copilot-log.md"));
      tracker.flushNow();

      expect(tracker.getEpoch("p")).toBe(0);
      tracker.dispose();
    });

    it("ignores a metadata change under a system Copilot root that property enumeration cannot reach", () => {
      // Chat autosave writes frontmatter-bearing notes into the Copilot root every
      // few seconds. `shouldIndexFile` always drops them, so they can never join a
      // property source's note set and must not dirty the project.
      mockRecords(record("p", { inclusions: "[Topics:Physics]" }));
      const { app, fire } = makeApp();
      const tracker = new ProjectContentTracker(app);

      fire("changed", file("copilot/copilot-conversations/chat.md"));
      tracker.flushNow();

      expect(tracker.getEpoch("p")).toBe(0);
      tracker.dispose();
    });

    it("tears down the metadata-cache listener via metadataCache.offref on dispose", () => {
      mockRecords(record("p", { inclusions: "[Topics:Physics]" }));
      const { app, metadataOffref, vaultOffref } = makeApp();
      const tracker = new ProjectContentTracker(app);

      tracker.dispose();

      expect(metadataOffref).toHaveBeenCalledTimes(1);
      expect(vaultOffref).toHaveBeenCalled();
    });

    it("stays inert to metadata events after dispose", () => {
      mockRecords(record("p", { inclusions: "[Topics:Physics]" }));
      const { app, fire } = makeApp();
      const tracker = new ProjectContentTracker(app);
      tracker.dispose();

      fire("changed", file("Notes/a.md"));
      tracker.flushNow();

      expect(tracker.getEpoch("p")).toBe(0);
    });
  });
});
