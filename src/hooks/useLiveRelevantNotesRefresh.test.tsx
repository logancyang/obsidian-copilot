import {
  LIVE_REFRESH_INTERVAL_MS,
  LIVE_REFRESH_WINDOW_MS,
  useLiveRelevantNotesRefresh,
} from "@/hooks/useLiveRelevantNotesRefresh";
import { act, renderHook } from "@testing-library/react";
import { TFile, type App, type EventRef } from "obsidian";

type ModifyHandler = (file: unknown) => void;

interface VaultHarness {
  app: App;
  emitModify: (file: unknown) => void;
  offref: jest.Mock;
  handlerCount: () => number;
}

function createVaultHarness(): VaultHarness {
  const handlers = new Set<ModifyHandler>();
  const offref = jest.fn((ref: EventRef) => {
    handlers.delete((ref as unknown as { handler: ModifyHandler }).handler);
  });
  const app = {
    vault: {
      on: jest.fn((event: string, handler: ModifyHandler) => {
        if (event === "modify") handlers.add(handler);
        return { handler };
      }),
      offref,
    },
  } as unknown as App;

  return {
    app,
    emitModify: (file) => act(() => handlers.forEach((handler) => handler(file))),
    offref,
    handlerCount: () => handlers.size,
  };
}

function createFile(path: string): TFile {
  const MockTFile = TFile as unknown as new (path: string) => TFile;
  const file = new MockTFile(path);
  file.path = path;
  return file;
}

describe("useLiveRelevantNotesRefresh", () => {
  describe("useLiveRelevantNotesRefresh()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("issues no query while the note is left untouched (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: "notes/draft.md",
          onRefresh,
        })
      );

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 10);
      });

      expect(onRefresh).not.toHaveBeenCalled();
    });

    it("re-queries on an interval once the note is written", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: "notes/draft.md",
          onRefresh,
        })
      );
      harness.emitModify(createFile("notes/draft.md"));

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 2);
      });

      expect(onRefresh).toHaveBeenCalledTimes(2);
    });

    it("keeps re-querying past the write so a slower re-embed is still picked up (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: "notes/draft.md",
          onRefresh,
        })
      );
      harness.emitModify(createFile("notes/draft.md"));

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_WINDOW_MS);
      });

      expect(onRefresh.mock.calls.length).toBeGreaterThan(1);
    });

    it("falls silent once the window since the last write has elapsed", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: "notes/draft.md",
          onRefresh,
        })
      );
      harness.emitModify(createFile("notes/draft.md"));

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_WINDOW_MS + LIVE_REFRESH_INTERVAL_MS * 2);
      });
      const settledCalls = onRefresh.mock.calls.length;
      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 10);
      });

      expect(onRefresh.mock.calls.length).toBe(settledCalls);
    });

    it("extends the window when the note is written again", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: "notes/draft.md",
          onRefresh,
        })
      );
      harness.emitModify(createFile("notes/draft.md"));
      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_WINDOW_MS - LIVE_REFRESH_INTERVAL_MS);
      });
      harness.emitModify(createFile("notes/draft.md"));
      const callsBefore = onRefresh.mock.calls.length;

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_WINDOW_MS);
      });

      expect(onRefresh.mock.calls.length).toBeGreaterThan(callsBefore + 1);
    });

    it("ignores writes to notes other than the one being related", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: "notes/draft.md",
          onRefresh,
        })
      );
      harness.emitModify(createFile("notes/other.md"));

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_WINDOW_MS);
      });

      expect(onRefresh).not.toHaveBeenCalled();
    });

    it("ignores modifications to folders", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: "notes/draft.md",
          onRefresh,
        })
      );
      harness.emitModify({ path: "notes/draft.md" });

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_WINDOW_MS);
      });

      expect(onRefresh).not.toHaveBeenCalled();
    });

    it("subscribes to nothing while live update is switched off", () => {
      const harness = createVaultHarness();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: false,
          filePath: "notes/draft.md",
          onRefresh: jest.fn(),
        })
      );

      expect(harness.handlerCount()).toBe(0);
    });

    it("subscribes to nothing while no note is open", () => {
      const harness = createVaultHarness();

      renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: undefined,
          onRefresh: jest.fn(),
        })
      );

      expect(harness.handlerCount()).toBe(0);
    });

    it("calls the latest callback rather than the one captured when it subscribed", () => {
      const harness = createVaultHarness();
      const first = jest.fn();
      const second = jest.fn();
      const { rerender } = renderHook(
        ({ onRefresh }: { onRefresh: () => void }) =>
          useLiveRelevantNotesRefresh({
            app: harness.app,
            enabled: true,
            filePath: "notes/draft.md",
            onRefresh,
          }),
        { initialProps: { onRefresh: first } }
      );
      harness.emitModify(createFile("notes/draft.md"));
      rerender({ onRefresh: second });

      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS);
      });

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("asks again and keeps asking when live update is switched on (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();
      const { rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useLiveRelevantNotesRefresh({
            app: harness.app,
            enabled,
            filePath: "notes/draft.md",
            onRefresh,
          }),
        { initialProps: { enabled: false } }
      );

      rerender({ enabled: true });
      expect(onRefresh).toHaveBeenCalledTimes(1);
      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 2);
      });

      expect(onRefresh).toHaveBeenCalledTimes(3);
    });

    it("issues no query when the note it is already following changes", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();
      const { rerender } = renderHook(
        ({ filePath }: { filePath: string }) =>
          useLiveRelevantNotesRefresh({
            app: harness.app,
            enabled: true,
            filePath,
            onRefresh,
          }),
        { initialProps: { filePath: "notes/draft.md" } }
      );

      rerender({ filePath: "notes/other.md" });
      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_WINDOW_MS);
      });

      expect(onRefresh).not.toHaveBeenCalled();
    });

    it("stops polling and unsubscribes when the pane closes", () => {
      const harness = createVaultHarness();
      const onRefresh = jest.fn();
      const { unmount } = renderHook(() =>
        useLiveRelevantNotesRefresh({
          app: harness.app,
          enabled: true,
          filePath: "notes/draft.md",
          onRefresh,
        })
      );
      harness.emitModify(createFile("notes/draft.md"));

      unmount();
      act(() => {
        jest.advanceTimersByTime(LIVE_REFRESH_WINDOW_MS);
      });

      expect(harness.offref).toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
    });
  });
});
