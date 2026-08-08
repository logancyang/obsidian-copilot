jest.mock("@/logger", () => ({ logError: jest.fn() }));

import { logError } from "@/logger";
import { toVoidHandler } from "@/utils/asyncHandler";

describe("asyncHandler", () => {
  describe("toVoidHandler()", () => {
    beforeEach(() => {
      jest.mocked(logError).mockClear();
    });

    it("forwards arguments and returns void", async () => {
      const handler = jest.fn(async (_value: string) => {});
      const voidHandler = toVoidHandler(handler, "save draft");

      const result = voidHandler("content");
      await Promise.resolve();

      expect(result).toBeUndefined();
      expect(handler).toHaveBeenCalledWith("content");
      expect(logError).not.toHaveBeenCalled();
    });

    it("reports a rejected callback promise", async () => {
      const failure = new Error("rejected");
      const rejection = Promise.reject(failure);
      const voidHandler = toVoidHandler(() => rejection, "save draft");

      voidHandler();
      await rejection.catch(() => undefined);

      expect(logError).toHaveBeenCalledWith("save draft failed", failure);
    });

    it("reports a callback that throws before returning a promise", () => {
      const failure = new Error("thrown");
      const handler = (() => {
        throw failure;
      }) as () => Promise<void>;

      toVoidHandler(handler, "save draft")();

      expect(logError).toHaveBeenCalledWith("save draft failed", failure);
    });
  });
});
