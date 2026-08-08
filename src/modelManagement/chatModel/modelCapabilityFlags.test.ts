import { ModelCapability } from "@/constants";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import { capabilityListFromModelInfo } from "./modelCapabilityFlags";

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

  it("reads vision from an image input modality only", () => {
    const info: ModelInfo = { id: "m", displayName: "M", modalities: { input: ["text", "image"] } };
    expect(capabilityListFromModelInfo(info)).toEqual([ModelCapability.VISION]);
  });

  it("is empty for an input without image", () => {
    const info: ModelInfo = { id: "m", displayName: "M", modalities: { input: ["text"] } };
    expect(capabilityListFromModelInfo(info)).toEqual([]);
  });

  it("returns an empty list for a plain model", () => {
    expect(capabilityListFromModelInfo({ id: "m", displayName: "M" })).toEqual([]);
  });
});
