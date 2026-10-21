const queryMock = jest.fn();
jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { getCachedSdkCatalog, probeClaudeSdkCatalog } from "./effortOption";

const CATALOG: ModelInfo[] = [{ value: "claude-x", displayName: "Claude X", description: "test" }];

function fakeProbe(models: ModelInfo[]) {
  return {
    initializationResult: jest.fn().mockResolvedValue({ models }),
    close: jest.fn(),
  };
}

beforeEach(() => queryMock.mockReset());

describe("effortOption", () => {
  describe("probeClaudeSdkCatalog()", () => {
    it("returns the probed catalog and passes env overrides merged onto process.env", async () => {
      queryMock.mockReturnValue(fakeProbe(CATALOG));
      const models = await probeClaudeSdkCatalog("/bin/claude", { ANTHROPIC_MODEL: "m-custom" });
      expect(models).toBe(CATALOG);
      const opts = (
        queryMock.mock.calls[0][0] as {
          options: { pathToClaudeCodeExecutable: string; env?: Record<string, string> };
        }
      ).options;
      expect(opts.pathToClaudeCodeExecutable).toBe("/bin/claude");
      expect(opts.env).toEqual({ ...process.env, ANTHROPIC_MODEL: "m-custom" });
    });

    it("leaves options.env unset when no env overrides are given", async () => {
      queryMock.mockReturnValue(fakeProbe(CATALOG));
      await probeClaudeSdkCatalog("/bin/claude", undefined);
      const opts = (queryMock.mock.calls[0][0] as { options: { env?: unknown } }).options;
      expect(opts.env).toBeUndefined();
    });

    it("closes its probe query once the catalog is read, so no Claude process outlives the probe", async () => {
      const probe = fakeProbe(CATALOG);
      queryMock.mockReturnValue(probe);
      await probeClaudeSdkCatalog("/bin/claude", undefined);
      expect(probe.close).toHaveBeenCalledTimes(1);
    });

    it("closes its probe query and returns no models when Claude fails to start", async () => {
      const probe = {
        initializationResult: jest.fn().mockRejectedValue(new Error("spawn failed")),
        close: jest.fn(),
      };
      queryMock.mockReturnValue(probe);
      await expect(probeClaudeSdkCatalog("/bin/claude", undefined)).resolves.toEqual([]);
      expect(probe.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("getCachedSdkCatalog()", () => {
    it("serves the cached catalog only to callers whose env overrides match, regardless of key order", async () => {
      queryMock.mockReturnValue(fakeProbe(CATALOG));
      await probeClaudeSdkCatalog("/bin/claude", { A: "1", B: "2" });
      expect(getCachedSdkCatalog({ B: "2", A: "1" })).toBe(CATALOG);
      expect(getCachedSdkCatalog({ A: "1", B: "9" })).toBeNull();
      expect(getCachedSdkCatalog(undefined)).toBeNull();
    });

    it("replaces the cached catalog when a later probe runs under different env overrides", async () => {
      queryMock.mockReturnValue(fakeProbe(CATALOG));
      await probeClaudeSdkCatalog("/bin/claude", { ANTHROPIC_MODEL: "first" });
      expect(getCachedSdkCatalog({ ANTHROPIC_MODEL: "first" })).toBe(CATALOG);

      const CATALOG2: ModelInfo[] = [{ value: "y", displayName: "Y", description: "t" }];
      queryMock.mockReturnValue(fakeProbe(CATALOG2));
      await probeClaudeSdkCatalog("/bin/claude", { ANTHROPIC_MODEL: "second" });
      expect(getCachedSdkCatalog({ ANTHROPIC_MODEL: "second" })).toBe(CATALOG2);
      expect(getCachedSdkCatalog({ ANTHROPIC_MODEL: "first" })).toBeNull();
    });

    it("caches nothing when the probe returns no models", async () => {
      queryMock.mockReturnValue(fakeProbe([]));
      await probeClaudeSdkCatalog("/bin/claude", { ANTHROPIC_MODEL: "empty-case" });
      expect(getCachedSdkCatalog({ ANTHROPIC_MODEL: "empty-case" })).toBeNull();
    });
  });
});
