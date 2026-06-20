import { ModelCapability } from "@/constants";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import {
  applyCapsToModelInfo,
  capabilityListFromModelInfo,
  capsFromModelInfo,
} from "./modelCapabilityFlags";

describe("capsFromModelInfo", () => {
  it("reads vision from an image input modality and reasoning from the flag", () => {
    const info: ModelInfo = {
      id: "m",
      displayName: "M",
      modalities: { input: ["text", "image"] },
      reasoning: true,
    };
    expect(capsFromModelInfo(info)).toEqual({ vision: true, reasoning: true });
  });

  it("defaults both to false when metadata is absent", () => {
    expect(capsFromModelInfo({ id: "m", displayName: "M" })).toEqual({
      vision: false,
      reasoning: false,
    });
  });

  it("is false for vision when input has no image", () => {
    const info: ModelInfo = { id: "m", displayName: "M", modalities: { input: ["text"] } };
    expect(capsFromModelInfo(info).vision).toBe(false);
  });
});

describe("capabilityListFromModelInfo", () => {
  it("maps reasoning + vision to the capability enum values", () => {
    const info: ModelInfo = {
      id: "m",
      displayName: "M",
      modalities: { input: ["text", "image"] },
      reasoning: true,
    };
    expect(capabilityListFromModelInfo(info)).toEqual([
      ModelCapability.REASONING,
      ModelCapability.VISION,
    ]);
  });

  it("returns an empty list for a plain model", () => {
    expect(capabilityListFromModelInfo({ id: "m", displayName: "M" })).toEqual([]);
  });
});

describe("applyCapsToModelInfo", () => {
  it("adds image while preserving other input modalities and output", () => {
    const info: ModelInfo = {
      id: "m",
      displayName: "M",
      modalities: { input: ["text", "audio"], output: ["text"] },
    };
    const next = applyCapsToModelInfo(info, { vision: true, reasoning: false });
    expect(next.modalities?.input).toEqual(["text", "audio", "image"]);
    expect(next.modalities?.output).toEqual(["text"]);
    expect(next.reasoning).toBe(false);
  });

  it("removes image while preserving other input modalities", () => {
    const info: ModelInfo = {
      id: "m",
      displayName: "M",
      modalities: { input: ["text", "image"], output: ["text"] },
    };
    const next = applyCapsToModelInfo(info, { vision: false, reasoning: false });
    expect(next.modalities?.input).toEqual(["text"]);
    expect(next.modalities?.output).toEqual(["text"]);
  });

  it("does not duplicate image when already present", () => {
    const info: ModelInfo = { id: "m", displayName: "M", modalities: { input: ["image"] } };
    const next = applyCapsToModelInfo(info, { vision: true, reasoning: false });
    expect(next.modalities?.input).toEqual(["image"]);
  });

  it("toggles reasoning independently", () => {
    const info: ModelInfo = { id: "m", displayName: "M" };
    expect(applyCapsToModelInfo(info, { vision: false, reasoning: true }).reasoning).toBe(true);
    expect(applyCapsToModelInfo(info, { vision: false, reasoning: false }).reasoning).toBe(false);
  });

  it("adds image to a plain model that had no modalities at all", () => {
    const info: ModelInfo = { id: "m", displayName: "M" };
    const next = applyCapsToModelInfo(info, { vision: true, reasoning: false });
    expect(next.modalities?.input).toEqual(["image"]);
  });

  it("omits modalities when input becomes empty and there is no output", () => {
    const info: ModelInfo = { id: "m", displayName: "M", modalities: { input: ["image"] } };
    const next = applyCapsToModelInfo(info, { vision: false, reasoning: false });
    expect(next.modalities).toBeUndefined();
  });

  it("keeps an output-only modalities object when input clears", () => {
    const info: ModelInfo = {
      id: "m",
      displayName: "M",
      modalities: { input: ["image"], output: ["text"] },
    };
    const next = applyCapsToModelInfo(info, { vision: false, reasoning: false });
    expect(next.modalities).toEqual({ output: ["text"] });
  });

  it("does not mutate the input object", () => {
    const input = ["text"];
    const info: ModelInfo = { id: "m", displayName: "M", modalities: { input } };
    applyCapsToModelInfo(info, { vision: true, reasoning: true });
    expect(input).toEqual(["text"]);
    expect(info.reasoning).toBeUndefined();
  });

  it("round-trips through capsFromModelInfo", () => {
    const info: ModelInfo = { id: "m", displayName: "M", modalities: { input: ["text"] } };
    const caps = { vision: true, reasoning: true };
    expect(capsFromModelInfo(applyCapsToModelInfo(info, caps))).toEqual(caps);
  });
});
