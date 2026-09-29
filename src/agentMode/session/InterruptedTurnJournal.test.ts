import { mockTFile } from "@/__tests__/mockObsidian";
import type { App } from "obsidian";
import {
  INTERRUPTED_TURN_JOURNAL_STORAGE_KEY,
  InterruptedTurnJournal,
} from "./InterruptedTurnJournal";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/607";
const KEY = "copilot-agent-session://claude/s-1";
const OTHER_KEY = "copilot-agent-session://codex/s-2";

function makeApp(existingPaths: string[] = []) {
  const storage = new Map<string, unknown>();
  const files = new Map(existingPaths.map((path) => [path, mockTFile({ path })]));
  const mocks = {
    loadLocalStorage: jest.fn((key: string) => storage.get(key) ?? null),
    saveLocalStorage: jest.fn((key: string, value: unknown) => {
      if (value === null) storage.delete(key);
      else storage.set(key, value);
    }),
    vault: { getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null) },
  };
  return { app: mocks as unknown as App, mocks, files, storage };
}

const IMAGE = { type: "image" as const, mimeType: "image/png", data: "aGVsbG8=" };

describe("InterruptedTurnJournal", () => {
  describe("record()", () => {
    it("stores the prompt so it can be read back with its attached notes, urls and agents", () => {
      const { app, files } = makeApp(["notes/a.md"]);
      const journal = new InterruptedTurnJournal(app);
      const note = files.get("notes/a.md")!;

      journal.record(KEY, {
        text: "Compare these",
        context: { notes: [note], urls: ["https://example.com"], tags: ["#todo"] },
        promptContent: [IMAGE],
        mentionedAgents: ["codex"],
      });

      expect(journal.read(KEY)).toEqual({
        text: "Compare these",
        context: { notes: [note], urls: ["https://example.com"], tags: ["#todo"] },
        promptContent: [IMAGE],
        mentionedAgents: ["codex"],
      });
    });

    it("keeps each chat's prompt separate", () => {
      const journal = new InterruptedTurnJournal(makeApp().app);

      journal.record(KEY, { text: "first" });
      journal.record(OTHER_KEY, { text: "second" });

      expect(journal.read(KEY)?.text).toBe("first");
      expect(journal.read(OTHER_KEY)?.text).toBe("second");
    });

    it("replaces the earlier prompt of the same chat", () => {
      const journal = new InterruptedTurnJournal(makeApp().app);

      journal.record(KEY, { text: "first" });
      journal.record(KEY, { text: "second" });

      expect(journal.read(KEY)?.text).toBe("second");
    });

    it(`keeps the text and drops images when the browser storage quota rejects them (${ISSUE})`, () => {
      const { app, mocks } = makeApp();
      mocks.saveLocalStorage.mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });
      const journal = new InterruptedTurnJournal(app);

      journal.record(KEY, {
        text: "Describe this",
        promptContent: [{ type: "text", text: "extra" }, IMAGE],
      });

      expect(journal.read(KEY)).toMatchObject({
        text: "Describe this",
        promptContent: [{ type: "text", text: "extra" }],
      });
    });

    it(`records nothing for an image-only prompt whose images the storage quota rejects, so Retry never sends an empty request (${ISSUE})`, () => {
      const { app, mocks } = makeApp();
      mocks.saveLocalStorage.mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });
      const journal = new InterruptedTurnJournal(app);

      journal.record(KEY, { text: "", promptContent: [IMAGE] });

      expect(journal.read(KEY)).toBeNull();
    });

    it("never throws when storage is unavailable, so sending a prompt cannot fail on it", () => {
      const { app, mocks } = makeApp();
      mocks.saveLocalStorage.mockImplementation(() => {
        throw new Error("storage disabled");
      });

      expect(() => new InterruptedTurnJournal(app).record(KEY, { text: "hi" })).not.toThrow();
    });
  });

  describe("clear()", () => {
    it("forgets a chat's prompt while leaving other chats' prompts", () => {
      const journal = new InterruptedTurnJournal(makeApp().app);
      journal.record(KEY, { text: "first" });
      journal.record(OTHER_KEY, { text: "second" });

      journal.clear(KEY);

      expect(journal.read(KEY)).toBeNull();
      expect(journal.read(OTHER_KEY)?.text).toBe("second");
    });

    it("removes the storage entry once the journal is empty", () => {
      const { app, storage } = makeApp();
      const journal = new InterruptedTurnJournal(app);
      journal.record(KEY, { text: "first" });

      journal.clear(KEY);

      expect(storage.has(INTERRUPTED_TURN_JOURNAL_STORAGE_KEY)).toBe(false);
    });
  });

  describe("read()", () => {
    it("returns null for a chat with no recorded prompt", () => {
      expect(new InterruptedTurnJournal(makeApp().app).read(KEY)).toBeNull();
    });

    it(`drops attached notes that no longer exist in the vault (${ISSUE})`, () => {
      const { app, files, mocks } = makeApp(["notes/a.md", "notes/b.md"]);
      const journal = new InterruptedTurnJournal(app);
      journal.record(KEY, {
        text: "Compare",
        context: { notes: [files.get("notes/a.md")!, files.get("notes/b.md")!], urls: [] },
      });
      files.delete("notes/b.md");
      mocks.vault.getAbstractFileByPath.mockImplementation(
        (path: string) => files.get(path) ?? null
      );

      expect(journal.read(KEY)?.context?.notes.map((note) => note.path)).toEqual(["notes/a.md"]);
    });

    it("ignores stored data that is not a journal", () => {
      const { app, storage } = makeApp();
      storage.set(INTERRUPTED_TURN_JOURNAL_STORAGE_KEY, "not json");

      expect(new InterruptedTurnJournal(app).read(KEY)).toBeNull();
    });
  });

  describe("retainOnly()", () => {
    it("forgets prompts of chats that are no longer open", () => {
      const journal = new InterruptedTurnJournal(makeApp().app);
      journal.record(KEY, { text: "first" });
      journal.record(OTHER_KEY, { text: "second" });

      journal.retainOnly(new Set([KEY]));

      expect(journal.read(KEY)?.text).toBe("first");
      expect(journal.read(OTHER_KEY)).toBeNull();
    });
  });

  describe("seal()", () => {
    it(`keeps in-flight prompts when shutdown cancels their turns (${ISSUE})`, () => {
      const journal = new InterruptedTurnJournal(makeApp().app);
      journal.record(KEY, { text: "in flight" });

      journal.seal();
      journal.clear(KEY);
      journal.record(OTHER_KEY, { text: "late" });
      journal.retainOnly(new Set());

      expect(journal.read(KEY)?.text).toBe("in flight");
      expect(journal.read(OTHER_KEY)).toBeNull();
    });
  });
});
