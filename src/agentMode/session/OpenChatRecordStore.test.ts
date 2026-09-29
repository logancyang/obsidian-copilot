import type { App } from "obsidian";
import { OPEN_CHAT_RECORD_STORAGE_KEY, OpenChatRecordStore } from "./OpenChatRecordStore";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

function makeApp(initial?: unknown) {
  const storage = new Map<string, unknown>();
  if (initial !== undefined) storage.set(OPEN_CHAT_RECORD_STORAGE_KEY, initial);
  const app = {
    loadLocalStorage: jest.fn((key: string) => storage.get(key) ?? null),
    saveLocalStorage: jest.fn((key: string, value: unknown) => void storage.set(key, value)),
  };
  return { app: app as unknown as App, storage, mocks: app };
}

const TAB = { backendId: "claude", sessionId: "s-1", sourcePath: "chats/one.md", active: true };

describe("OpenChatRecordStore", () => {
  describe("load()", () => {
    it("returns the tabs saved earlier, in order, with the active flag", () => {
      const { app } = makeApp();
      const first = new OpenChatRecordStore(app);
      const second = { backendId: "codex", sessionId: "s-2", active: false };
      first.save([TAB, second]);

      expect(new OpenChatRecordStore(app).load()).toEqual([TAB, second]);
    });

    it("returns no tabs when nothing was ever saved", () => {
      expect(new OpenChatRecordStore(makeApp().app).load()).toEqual([]);
    });

    it("returns the same frozen empty list every time so callers keep referential stability", () => {
      const store = new OpenChatRecordStore(makeApp().app);

      expect(store.load()).toBe(store.load());
      expect(Object.isFrozen(store.load())).toBe(true);
    });

    it("skips entries that lack a backend id, session id or active flag", () => {
      const { app } = makeApp(
        JSON.stringify([TAB, { sessionId: "x", active: false }, { backendId: "claude" }, 7])
      );

      expect(new OpenChatRecordStore(app).load()).toEqual([TAB]);
    });

    it("returns no tabs when the stored value is not valid JSON", () => {
      expect(new OpenChatRecordStore(makeApp("{oops").app).load()).toEqual([]);
    });

    it("returns no tabs when local storage throws", () => {
      const { app, mocks } = makeApp();
      mocks.loadLocalStorage.mockImplementation(() => {
        throw new Error("storage disabled");
      });

      expect(new OpenChatRecordStore(app).load()).toEqual([]);
    });
  });

  describe("save()", () => {
    it("writes to vault-scoped local storage rather than plugin settings", () => {
      const { app, mocks } = makeApp();

      new OpenChatRecordStore(app).save([TAB]);

      expect(mocks.saveLocalStorage).toHaveBeenCalledWith(
        OPEN_CHAT_RECORD_STORAGE_KEY,
        JSON.stringify([TAB])
      );
    });

    it("does not rewrite a record that has not changed", () => {
      const { app, mocks } = makeApp();
      const store = new OpenChatRecordStore(app);

      store.save([TAB]);
      store.save([{ ...TAB }]);

      expect(mocks.saveLocalStorage).toHaveBeenCalledTimes(1);
    });

    it("does not rewrite the record it just loaded", () => {
      const { app, mocks } = makeApp(JSON.stringify([TAB]));
      const store = new OpenChatRecordStore(app);

      store.load();
      store.save([TAB]);

      expect(mocks.saveLocalStorage).not.toHaveBeenCalled();
    });

    it("keeps working when local storage rejects the write", () => {
      const { app, mocks } = makeApp();
      mocks.saveLocalStorage.mockImplementation(() => {
        throw new Error("quota exceeded");
      });

      expect(() => new OpenChatRecordStore(app).save([TAB])).not.toThrow();
    });
  });
});
