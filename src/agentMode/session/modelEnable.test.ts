import type { ModelInfo } from "@agentclientprotocol/sdk";
import { isAgentModelEnabled, isAgentModelEnabledOrKept } from "./modelEnable";
import type { BackendDescriptor } from "./types";

const baseDescriptor = {
  id: "test",
  displayName: "Test",
} as unknown as BackendDescriptor;

const model = (modelId: string, name = modelId): ModelInfo => ({ modelId, name });

describe("isAgentModelEnabled", () => {
  it("returns true when no override and no descriptor policy", () => {
    expect(isAgentModelEnabled(baseDescriptor, model("foo"), undefined)).toBe(true);
  });

  it("respects an explicit override of true", () => {
    expect(isAgentModelEnabled(baseDescriptor, model("foo"), { foo: true })).toBe(true);
  });

  it("respects an explicit override of false", () => {
    const descriptor = {
      ...baseDescriptor,
      isModelEnabledByDefault: () => true,
    } as BackendDescriptor;
    expect(isAgentModelEnabled(descriptor, model("foo"), { foo: false })).toBe(false);
  });

  it("falls back to descriptor policy when no override exists", () => {
    const descriptor = {
      ...baseDescriptor,
      isModelEnabledByDefault: (m: ModelInfo) => m.modelId === "wanted",
    } as BackendDescriptor;
    expect(isAgentModelEnabled(descriptor, model("wanted"), undefined)).toBe(true);
    expect(isAgentModelEnabled(descriptor, model("other"), undefined)).toBe(false);
  });

  it("override wins even when descriptor policy disagrees", () => {
    const descriptor = {
      ...baseDescriptor,
      isModelEnabledByDefault: () => false,
    } as BackendDescriptor;
    expect(isAgentModelEnabled(descriptor, model("foo"), { foo: true })).toBe(true);
  });

  it("treats missing override key as 'no override'", () => {
    const descriptor = {
      ...baseDescriptor,
      isModelEnabledByDefault: () => false,
    } as BackendDescriptor;
    expect(isAgentModelEnabled(descriptor, model("foo"), { bar: true })).toBe(false);
  });
});

describe("isAgentModelEnabledOrKept", () => {
  const restrictive = {
    ...baseDescriptor,
    isModelEnabledByDefault: () => false,
  } as BackendDescriptor;

  it("force-enables the kept model even when policy disables it", () => {
    expect(isAgentModelEnabledOrKept(restrictive, model("kept"), undefined, "kept")).toBe(true);
  });

  it("force-enables the kept model even when an override disables it", () => {
    expect(isAgentModelEnabledOrKept(restrictive, model("kept"), { kept: false }, "kept")).toBe(
      true
    );
  });

  it("falls through to normal resolution for non-kept models", () => {
    expect(isAgentModelEnabledOrKept(restrictive, model("other"), undefined, "kept")).toBe(false);
  });

  it("treats null keepModelId as 'no carve-out'", () => {
    expect(isAgentModelEnabledOrKept(restrictive, model("foo"), undefined, null)).toBe(false);
  });
});
