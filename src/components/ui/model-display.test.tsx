import { render } from "@testing-library/react";
import React from "react";
import { ModelCapabilityIcons, getModelDisplayWithIcons } from "./model-display";
import type { CustomModel } from "@/aiParams";
import { ModelCapability } from "@/constants";

describe("ModelCapabilityIcons", () => {
  it("renders an icon for vision and websearch but never for reasoning", () => {
    const { container } = render(
      <ModelCapabilityIcons
        capabilities={[
          ModelCapability.VISION,
          ModelCapability.REASONING,
          ModelCapability.WEB_SEARCH,
        ]}
      />
    );
    // Reasoning is intentionally not rendered (ubiquitous; kept runtime-only),
    // so only the vision + websearch icons appear.
    expect(container.querySelectorAll("svg").length).toBe(2);
  });

  it("renders nothing when the only capability is reasoning", () => {
    const { container } = render(
      <ModelCapabilityIcons capabilities={[ModelCapability.REASONING]} />
    );
    expect(container.querySelectorAll("svg").length).toBe(0);
  });
});

describe("getModelDisplayWithIcons", () => {
  it("omits the Reasoning label while keeping Vision", () => {
    const model: CustomModel = {
      name: "omni",
      provider: "openai",
      enabled: true,
      capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
    };
    const text = getModelDisplayWithIcons(model);
    expect(text).toContain("Vision");
    expect(text).not.toContain("Reasoning");
  });
});
