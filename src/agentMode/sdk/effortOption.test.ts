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
    interrupt: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => queryMock.mockReset());

describe("probeClaudeSdkCatalog env passing", () => {
  it("merges env overrides onto process.env so the CLI can reflect ANTHROPIC_MODEL", async () => {
    queryMock.mockReturnValue(fakeProbe(CATALOG));
    const models = await probeClaudeSdkCatalog("/bin/claude", { ANTHROPIC_MODEL: "m-custom" });
    expect(models).toBe(CATALOG);
    const opts = (
      queryMock.mock.calls[0][0] as {
        options: { pathToClaudeCodeExecutable: string; env?: Record<string, string> };
      }
    ).options;
    expect(opts.pathToClaudeCodeExecutable).toBe("/bin/claude");
    expect(opts.env?.ANTHROPIC_MODEL).toBe("m-custom");
    // process.env is preserved (Options.env replaces the child env wholesale).
    expect(opts.env?.PATH).toBe(process.env.PATH);
  });

  it("omits options.env entirely when there are no overrides", async () => {
    queryMock.mockReturnValue(fakeProbe(CATALOG));
    await probeClaudeSdkCatalog("/bin/claude", undefined);
    const opts = (queryMock.mock.calls[0][0] as { options: { env?: unknown } }).options;
    expect(opts.env).toBeUndefined();
  });
});

describe("getCachedSdkCatalog is scoped to the probe's env overrides", () => {
  it("serves the cache only for a matching env key, order-independent", async () => {
    queryMock.mockReturnValue(fakeProbe(CATALOG));
    await probeClaudeSdkCatalog("/bin/claude", { A: "1", B: "2" });
    expect(getCachedSdkCatalog({ B: "2", A: "1" })).toBe(CATALOG);
    expect(getCachedSdkCatalog({ A: "1", B: "9" })).toBeNull();
    expect(getCachedSdkCatalog(undefined)).toBeNull();
  });

  it("a fresh probe under a new env replaces the cached entry", async () => {
    queryMock.mockReturnValue(fakeProbe(CATALOG));
    await probeClaudeSdkCatalog("/bin/claude", { ANTHROPIC_MODEL: "first" });
    expect(getCachedSdkCatalog({ ANTHROPIC_MODEL: "first" })).toBe(CATALOG);

    const CATALOG2: ModelInfo[] = [{ value: "y", displayName: "Y", description: "t" }];
    queryMock.mockReturnValue(fakeProbe(CATALOG2));
    await probeClaudeSdkCatalog("/bin/claude", { ANTHROPIC_MODEL: "second" });
    expect(getCachedSdkCatalog({ ANTHROPIC_MODEL: "second" })).toBe(CATALOG2);
    // Single-slot, env-scoped: the prior env no longer hits.
    expect(getCachedSdkCatalog({ ANTHROPIC_MODEL: "first" })).toBeNull();
  });

  it("leaves the cache unwritten when the probe returns no models", async () => {
    queryMock.mockReturnValue(fakeProbe([]));
    await probeClaudeSdkCatalog("/bin/claude", { ANTHROPIC_MODEL: "empty-case" });
    expect(getCachedSdkCatalog({ ANTHROPIC_MODEL: "empty-case" })).toBeNull();
  });
});
