import { agentOriginEnabledModelEntries } from "./agentEnabledModels";
import type { CopilotSettings } from "@/settings/model";
import type { ConfiguredModel } from "@/modelManagement";

/** Bare descriptor-style decode (claude): the wire id IS the baseModelId. */
const bareDecode = (wireId: string): { selection: { baseModelId: string } } => ({
  selection: { baseModelId: wireId },
});

/** Suffix-style decode (codex): `<base>/<effort>` strips a known effort. */
const KNOWN_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const suffixDecode = (wireId: string): { selection: { baseModelId: string } } => {
  const segments = wireId.split("/");
  if (segments.length === 2 && KNOWN_EFFORTS.has(segments[1])) {
    return { selection: { baseModelId: segments[0] } };
  }
  return { selection: { baseModelId: wireId } };
};

function model(configuredModelId: string, infoId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId: "p1",
    info: { id: infoId, displayName: infoId },
    configuredAt: 0,
  };
}

function settingsWith(
  agentType: "claude" | "codex",
  enabledModels: string[],
  configuredModels: ConfiguredModel[]
): CopilotSettings {
  return {
    backends: { [agentType]: { enabledModels } },
    configuredModels,
  } as unknown as CopilotSettings;
}

describe("agentOriginEnabledModelEntries", () => {
  it("returns the shared frozen empty array when nothing is enabled", () => {
    const a = agentOriginEnabledModelEntries(settingsWith("claude", [], []), "claude", bareDecode);
    const b = agentOriginEnabledModelEntries(settingsWith("codex", [], []), "codex", suffixDecode);
    expect(a).toHaveLength(0);
    // Frozen empty constant — same reference across calls (referential stability).
    expect(a).toBe(b);
  });

  it("claude: maps enabled configured-model ids to their bare info.id baseModelId, all ok", () => {
    const settings = settingsWith(
      "claude",
      ["cm1", "cm2"],
      [model("cm1", "claude-sonnet-4-5"), model("cm2", "claude-opus-4-1")]
    );
    const entries = agentOriginEnabledModelEntries(settings, "claude", bareDecode);
    expect(entries.map((e) => e.baseModelId).sort()).toEqual([
      "claude-opus-4-1",
      "claude-sonnet-4-5",
    ]);
    // Agent-native: CLI-owned auth, never a credential flag.
    expect(entries.every((e) => e.credentialState === "ok")).toBe(true);
    expect(entries[0].name).toBe("claude-sonnet-4-5");
  });

  it("codex: strips the effort suffix to the base model id", () => {
    const settings = settingsWith("codex", ["cm1"], [model("cm1", "gpt-5/high")]);
    const entries = agentOriginEnabledModelEntries(settings, "codex", suffixDecode);
    expect(entries.map((e) => e.baseModelId)).toEqual(["gpt-5"]);
  });

  it("skips enabled ids with no matching configured-model row", () => {
    const settings = settingsWith("claude", ["cm1", "ghost"], [model("cm1", "claude-sonnet-4-5")]);
    const entries = agentOriginEnabledModelEntries(settings, "claude", bareDecode);
    expect(entries.map((e) => e.baseModelId)).toEqual(["claude-sonnet-4-5"]);
  });

  it("only reads the requested agentType's enabledModels", () => {
    const settings = {
      backends: {
        claude: { enabledModels: ["cm1"] },
        codex: { enabledModels: ["cm2"] },
      },
      configuredModels: [model("cm1", "claude-sonnet-4-5"), model("cm2", "gpt-5")],
    } as unknown as CopilotSettings;
    const claude = agentOriginEnabledModelEntries(settings, "claude", bareDecode);
    expect(claude.map((e) => e.baseModelId)).toEqual(["claude-sonnet-4-5"]);
  });
});
