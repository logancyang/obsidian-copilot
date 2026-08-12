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
