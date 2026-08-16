import React, { memo } from "react";
import { render } from "@testing-library/react";
import { logError } from "@/logger";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

jest.mock("@/logger", () => ({
  logError: jest.fn(),
}));

const mockedLogError = logError as jest.MockedFunction<typeof logError>;

describe("safeAsyncHandler", () => {
  describe("safeAsyncHandler()", () => {
    beforeEach(() => {
      mockedLogError.mockClear();
    });

    it("invokes the handler synchronously with the original arguments", async () => {
      const handler = jest.fn(async (a: string, b: number) => `${a}-${b}`);
      const wrapped = safeAsyncHandler(handler);

      wrapped("click", 42);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("click", 42);
    });

    it("returns undefined regardless of the handler's resolved value", () => {
      const wrapped = safeAsyncHandler(async () => "resolved value");

      expect(wrapped()).toBeUndefined();
    });

    it("logs a rejection through logError instead of leaving it unhandled", async () => {
      const failure = new Error("save failed");
      const wrapped = safeAsyncHandler(async () => {
        throw failure;
      });

      wrapped();
      await Promise.resolve();

      expect(mockedLogError).toHaveBeenCalledTimes(1);
      expect(mockedLogError).toHaveBeenCalledWith(expect.any(String), failure);
    });

    it("does not log when the handler resolves", async () => {
      const wrapped = safeAsyncHandler(async () => undefined);

      wrapped();
      await Promise.resolve();

      expect(mockedLogError).not.toHaveBeenCalled();
    });

    it("returns the same wrapper for a handler it has already adapted", () => {
      const handler = async () => undefined;

      expect(safeAsyncHandler(handler)).toBe(safeAsyncHandler(handler));
    });

    it("returns a distinct wrapper per handler, so two handlers never share one", () => {
      const first = async () => "first";
      const second = async () => "second";

      expect(safeAsyncHandler(first)).not.toBe(safeAsyncHandler(second));
    });

    it("forwards to the original handler when the wrapper is served from the cache", async () => {
      const handler = jest.fn(async (id: string) => id);
      safeAsyncHandler(handler);

      safeAsyncHandler(handler)("chat-1");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("chat-1");
    });

    it("logs rejections through a cached wrapper as it does through a fresh one", async () => {
      const failure = new Error("load failed");
      const handler = async () => {
        throw failure;
      };
      safeAsyncHandler(handler);

      safeAsyncHandler(handler)();
      await Promise.resolve();

      expect(mockedLogError).toHaveBeenCalledTimes(1);
      expect(mockedLogError).toHaveBeenCalledWith(expect.any(String), failure);
    });

    it("leaves a memoized child unrendered when its parent rerenders around it", () => {
      // The shape every call site relies on: wrap during render, hand the result
      // to a memo'd child, and rerender the parent for an unrelated reason (a
      // composer keystroke, a streamed token). A wrapper allocated per render
      // would break the child's shallow prop comparison and remap the list.
      const renderChild = jest.fn();
      const Child = memo(function Child({ onAct }: { onAct: () => void }) {
        renderChild();
        return (
          <button type="button" onClick={onAct}>
            act
          </button>
        );
      });
      const handler = async () => undefined;
      function Parent({ unrelated }: { unrelated: number }) {
        return (
          <div data-testid={`parent-${unrelated}`}>
            <Child onAct={safeAsyncHandler(handler)} />
          </div>
        );
      }

      const { rerender } = render(<Parent unrelated={1} />);
      rerender(<Parent unrelated={2} />);
      rerender(<Parent unrelated={3} />);

      expect(renderChild).toHaveBeenCalledTimes(1);
    });

    it("handles each invocation independently, logging every rejection", async () => {
      let calls = 0;
      const wrapped = safeAsyncHandler(async () => {
        calls += 1;
        if (calls === 2) {
          throw new Error(`failure ${calls}`);
        }
      });

      wrapped();
      wrapped();
      wrapped();
      await Promise.resolve();

      expect(calls).toBe(3);
      expect(mockedLogError).toHaveBeenCalledTimes(1);
      expect(mockedLogError).toHaveBeenCalledWith(expect.any(String), new Error("failure 2"));
    });
  });
});
