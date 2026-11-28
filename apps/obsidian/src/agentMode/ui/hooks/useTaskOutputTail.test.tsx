import type { TaskOutputReader } from "@/agentMode/session/taskOutputTail";
import {
  TASK_OUTPUT_POLL_MS,
  TaskOutputReaderContext,
  useTaskOutputTail,
} from "@/agentMode/ui/hooks/useTaskOutputTail";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";

const ISSUE_749 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/749";
const PATH = "/tmp/tasks/b1.output";

function countingReader(file: { text: string }) {
  const calls = { size: 0 };
  const reader: TaskOutputReader = {
    size: async () => {
      calls.size += 1;
      return new TextEncoder().encode(file.text).length;
    },
    read: async (_path, start, length) =>
      new TextEncoder().encode(file.text).slice(start, start + length),
  };
  const createReader = () => reader;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TaskOutputReaderContext.Provider value={createReader}>
      {children}
    </TaskOutputReaderContext.Provider>
  );
  return { calls, wrapper };
}

describe("useTaskOutputTail", () => {
  describe("useTaskOutputTail()", () => {
    afterEach(() => jest.useRealTimers());

    it(`re-reads a live command's output file while shown and stops when unmounted (${ISSUE_749})`, async () => {
      jest.useFakeTimers();
      const file = { text: "line 1\n" };
      const { calls, wrapper } = countingReader(file);
      const { result, unmount } = renderHook(
        () => useTaskOutputTail(PATH, { live: true, maxBytes: 1024 }),
        { wrapper }
      );
      await waitFor(() => expect(result.current.text).toBe("line 1\n"));

      file.text += "line 2\n";
      await act(() => jest.advanceTimersByTimeAsync(TASK_OUTPUT_POLL_MS));
      expect(result.current.text).toBe("line 1\nline 2\n");

      unmount();
      const readsAtUnmount = calls.size;
      await act(() => jest.advanceTimersByTimeAsync(TASK_OUTPUT_POLL_MS * 3));
      expect(calls.size).toBe(readsAtUnmount);
    });

    it(`skips its re-reads while the view showing the output is hidden (${ISSUE_749})`, async () => {
      jest.useFakeTimers();
      const file = { text: "line 1\n" };
      const { calls, wrapper } = countingReader(file);
      const view = { shown: true };
      const shownRef = { current: { isShown: () => view.shown } as unknown as HTMLElement };
      const { result } = renderHook(
        () => useTaskOutputTail(PATH, { live: true, maxBytes: 1024, shownRef }),
        { wrapper }
      );
      await waitFor(() => expect(result.current.text).toBe("line 1\n"));

      view.shown = false;
      const readsWhenHidden = calls.size;
      await act(() => jest.advanceTimersByTimeAsync(TASK_OUTPUT_POLL_MS * 3));
      expect(calls.size).toBe(readsWhenHidden);

      view.shown = true;
      file.text += "line 2\n";
      await act(() => jest.advanceTimersByTimeAsync(TASK_OUTPUT_POLL_MS));
      expect(result.current.text).toBe("line 1\nline 2\n");
    });

    it("reads an ended command's output once and does not keep polling", async () => {
      jest.useFakeTimers();
      const { calls, wrapper } = countingReader({ text: "done\n" });
      const { result } = renderHook(
        () => useTaskOutputTail(PATH, { live: false, maxBytes: 1024 }),
        { wrapper }
      );
      await waitFor(() => expect(result.current.text).toBe("done\n"));

      await act(() => jest.advanceTimersByTimeAsync(TASK_OUTPUT_POLL_MS * 3));

      expect(calls.size).toBe(1);
    });

    it("returns no output and reads nothing without an output file", () => {
      const { calls, wrapper } = countingReader({ text: "unused" });
      const { result } = renderHook(
        () => useTaskOutputTail(undefined, { live: true, maxBytes: 1024 }),
        { wrapper }
      );

      expect(result.current).toEqual({ text: "", truncated: false });
      expect(calls.size).toBe(0);
    });
  });
});
