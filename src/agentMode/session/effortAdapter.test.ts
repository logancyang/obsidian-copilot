import type { ModelInfo, SessionConfigOption, SessionModelState } from "@agentclientprotocol/sdk";
import {
  buildEffortAdapter,
  dedupeAvailableModels,
  type EffortApplyContext,
} from "./effortAdapter";
import type { BackendDescriptor } from "./types";

const opencodeStub: BackendDescriptor = {
  id: "opencode",
  displayName: "opencode",
  getInstallState: () => ({ kind: "absent" }),
  subscribeInstallState: () => () => {},
  openInstallUI: () => {},
  createBackend: (() => {
    throw new Error("not used in tests");
  }) as unknown as BackendDescriptor["createBackend"],
  parseEffortFromModelId(modelId) {
    if (!modelId) return null;
    const segs = modelId.split("/");
    if (segs.length === 2) return { baseId: modelId, effort: null };
    if (segs.length === 3) return { baseId: `${segs[0]}/${segs[1]}`, effort: segs[2] };
    return null;
  },
  composeModelId(baseId, effort) {
    return effort ? `${baseId}/${effort}` : baseId;
  },
};

const claudeCodeStub: BackendDescriptor = {
  id: "claude-code",
  displayName: "Claude Code",
  getInstallState: () => ({ kind: "absent" }),
  subscribeInstallState: () => () => {},
  openInstallUI: () => {},
  createBackend: (() => {
    throw new Error("not used in tests");
  }) as unknown as BackendDescriptor["createBackend"],
  findEffortConfigOption(opts) {
    if (!opts) return null;
    return (
      opts.find(
        (o) =>
          o.type === "select" &&
          (o.id === "effort" || o.category === "thought_level" || o.category === "effort")
      ) ?? null
    );
  },
};

function makeApplyCtx(): EffortApplyContext & {
  setSessionModel: jest.Mock;
  setSessionConfigOption: jest.Mock;
  persistModelSelection: jest.Mock;
  persistEffort: jest.Mock;
} {
  return {
    setSessionModel: jest.fn(async () => {}),
    setSessionConfigOption: jest.fn(async () => {}),
    persistModelSelection: jest.fn(async () => {}),
    persistEffort: jest.fn(async () => {}),
  };
}

function model(modelId: string, name = modelId): ModelInfo {
  return { modelId, name };
}

describe("dedupeAvailableModels", () => {
  it("collapses bare + variants into the bare entry", () => {
    const input = [
      model("anthropic/claude-sonnet-4-5", "Anthropic/Claude Sonnet 4.5"),
      model("anthropic/claude-sonnet-4-5/low", "Anthropic/Claude Sonnet 4.5 (low)"),
      model("anthropic/claude-sonnet-4-5/high", "Anthropic/Claude Sonnet 4.5 (high)"),
    ];
    const out = dedupeAvailableModels(input, opencodeStub);
    expect(out).toEqual([
      { modelId: "anthropic/claude-sonnet-4-5", name: "Anthropic/Claude Sonnet 4.5" },
    ]);
  });

  it("strips the variant suffix without inventing a bare id when no bare entry exists", () => {
    const input = [
      model("openai/gpt-5/low", "OpenAI/GPT-5 (low)"),
      model("openai/gpt-5/high", "OpenAI/GPT-5 (high)"),
    ];
    const out = dedupeAvailableModels(input, opencodeStub);
    expect(out).toEqual([{ modelId: "openai/gpt-5/low", name: "OpenAI/GPT-5" }]);
  });

  it("returns input unchanged when descriptor has no parser", () => {
    const input = [model("a/b"), model("c/d/e")];
    const out = dedupeAvailableModels(input, claudeCodeStub);
    expect(out).toEqual(input);
  });

  it("treats unparseable ids as their own buckets", () => {
    const input = [model("a/b/c/d"), model("a/b")];
    const out = dedupeAvailableModels(input, opencodeStub);
    // a/b/c/d is unparseable → its own bucket; a/b is its own.
    expect(out.map((m) => m.modelId)).toEqual(["a/b/c/d", "a/b"]);
  });
});

describe("buildEffortAdapter (opencode-style)", () => {
  function modelState(currentModelId: string, ids: string[]): SessionModelState {
    return {
      currentModelId,
      availableModels: ids.map((id) => model(id)),
    };
  }

  it("returns null when only one variant exists", () => {
    const ms = modelState("a/b", ["a/b"]);
    expect(buildEffortAdapter(opencodeStub, { modelState: ms, configOptions: null })).toBeNull();
  });

  it("returns null when current modelId doesn't parse", () => {
    const ms = modelState("a/b/c/d", ["a/b/c/d"]);
    expect(buildEffortAdapter(opencodeStub, { modelState: ms, configOptions: null })).toBeNull();
  });

  it("emits Default first when bare exists, then variants in order", () => {
    const ms = modelState("a/b/medium", ["a/b", "a/b/low", "a/b/medium", "a/b/high"]);
    const adapter = buildEffortAdapter(opencodeStub, { modelState: ms, configOptions: null });
    expect(adapter).not.toBeNull();
    expect(adapter!.kind).toBe("model");
    expect(adapter!.options).toEqual([
      { value: null, label: "Default" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ]);
    expect(adapter!.currentValue).toBe("medium");
  });

  it("omits Default when no bare exists", () => {
    const ms = modelState("a/b/low", ["a/b/low", "a/b/high"]);
    const adapter = buildEffortAdapter(opencodeStub, { modelState: ms, configOptions: null });
    expect(adapter!.options).toEqual([
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ]);
  });

  it("apply composes the new modelId and persists", async () => {
    const ms = modelState("a/b/medium", ["a/b", "a/b/medium", "a/b/high"]);
    const adapter = buildEffortAdapter(opencodeStub, { modelState: ms, configOptions: null })!;
    const ctx = makeApplyCtx();
    await adapter.applyEffort("high", ctx);
    expect(ctx.setSessionModel).toHaveBeenCalledWith("a/b/high");
    expect(ctx.persistModelSelection).toHaveBeenCalledWith("a/b/high");
    expect(ctx.setSessionConfigOption).not.toHaveBeenCalled();
    expect(ctx.persistEffort).not.toHaveBeenCalled();
  });

  it("apply(null) selects the bare baseId", async () => {
    const ms = modelState("a/b/high", ["a/b", "a/b/high"]);
    const adapter = buildEffortAdapter(opencodeStub, { modelState: ms, configOptions: null })!;
    const ctx = makeApplyCtx();
    await adapter.applyEffort(null, ctx);
    expect(ctx.setSessionModel).toHaveBeenCalledWith("a/b");
    expect(ctx.persistModelSelection).toHaveBeenCalledWith("a/b");
  });
});

describe("buildEffortAdapter (configOption-style)", () => {
  it("returns null when no matching config option exists", () => {
    const opts: SessionConfigOption[] = [
      {
        id: "model",
        category: "model",
        type: "select",
        name: "Model",
        currentValue: "x",
        options: [{ value: "x", name: "X" }],
      },
    ];
    expect(
      buildEffortAdapter(claudeCodeStub, { modelState: null, configOptions: opts })
    ).toBeNull();
  });

  it("matches id=effort and surfaces options verbatim", () => {
    const opts: SessionConfigOption[] = [
      {
        id: "effort",
        category: "effort",
        type: "select",
        name: "Effort",
        currentValue: "medium",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      },
    ];
    const adapter = buildEffortAdapter(claudeCodeStub, { modelState: null, configOptions: opts })!;
    expect(adapter.kind).toBe("configOption");
    expect(adapter.currentValue).toBe("medium");
    expect(adapter.options).toEqual([
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ]);
  });

  it("matches category=thought_level (spec-reserved) too", () => {
    const opts: SessionConfigOption[] = [
      {
        id: "reasoning",
        category: "thought_level",
        type: "select",
        name: "Reasoning",
        currentValue: "off",
        options: [{ value: "off", name: "Off" }],
      },
    ];
    const adapter = buildEffortAdapter(claudeCodeStub, { modelState: null, configOptions: opts });
    expect(adapter).not.toBeNull();
    expect(adapter!.currentValue).toBe("off");
  });

  it("apply calls setSessionConfigOption + persistEffort", async () => {
    const opts: SessionConfigOption[] = [
      {
        id: "effort",
        category: "effort",
        type: "select",
        name: "Effort",
        currentValue: "medium",
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      },
    ];
    const adapter = buildEffortAdapter(claudeCodeStub, { modelState: null, configOptions: opts })!;
    const ctx = makeApplyCtx();
    await adapter.applyEffort("high", ctx);
    expect(ctx.setSessionConfigOption).toHaveBeenCalledWith("effort", "high");
    expect(ctx.persistEffort).toHaveBeenCalledWith("high");
    expect(ctx.setSessionModel).not.toHaveBeenCalled();
  });

  it("apply(null) is a no-op for configOption-backed efforts", async () => {
    const opts: SessionConfigOption[] = [
      {
        id: "effort",
        category: "effort",
        type: "select",
        name: "Effort",
        currentValue: "low",
        options: [{ value: "low", name: "Low" }],
      },
    ];
    const adapter = buildEffortAdapter(claudeCodeStub, { modelState: null, configOptions: opts })!;
    const ctx = makeApplyCtx();
    await adapter.applyEffort(null, ctx);
    expect(ctx.setSessionConfigOption).not.toHaveBeenCalled();
    expect(ctx.persistEffort).not.toHaveBeenCalled();
  });
});
