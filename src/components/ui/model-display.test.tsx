import { render } from "@testing-library/react";
import React from "react";
import {
  ModelCapabilityIcons,
  getModelDisplayWithIcons,
  hasCapabilityIcons,
} from "./model-display";
import type { CustomModel } from "@/aiParams";
import { ModelCapability } from "@/constants";

const NO_VISION = "model-cap-no-vision";

describe("ModelCapabilityIcons", () => {
  it("renders nothing for unknown capabilities (undefined)", () => {
    // `undefined` = no modality snapshot. We must NOT assert a missing
    // capability — render nothing, distinct from the eye-off below.
    const { container, queryByTestId } = render(<ModelCapabilityIcons capabilities={undefined} />);
    expect(container.querySelectorAll("svg").length).toBe(0);
    expect(queryByTestId(NO_VISION)).toBeNull();
  });

  it("renders the eye-off for a known model that lacks vision (empty array)", () => {
    const { container, queryByTestId } = render(<ModelCapabilityIcons capabilities={[]} />);
    expect(queryByTestId(NO_VISION)).not.toBeNull();
    expect(container.querySelectorAll("svg").length).toBe(1);
  });

  it("renders no icon for a vision-capable model", () => {
    // Vision is the norm — we don't badge it (mirrors the hidden reasoning icon).
    const { container, queryByTestId } = render(
      <ModelCapabilityIcons capabilities={[ModelCapability.VISION]} />
    );
    expect(container.querySelectorAll("svg").length).toBe(0);
    expect(queryByTestId(NO_VISION)).toBeNull();
  });

  it("renders the globe only for a vision + web-search model", () => {
    const { container, queryByTestId } = render(
      <ModelCapabilityIcons capabilities={[ModelCapability.VISION, ModelCapability.WEB_SEARCH]} />
    );
    expect(container.querySelectorAll("svg").length).toBe(1);
    expect(queryByTestId(NO_VISION)).toBeNull();
  });

  it("renders the globe and the eye-off for a web-search-only model", () => {
    const { container, queryByTestId } = render(
      <ModelCapabilityIcons capabilities={[ModelCapability.WEB_SEARCH]} />
    );
    expect(container.querySelectorAll("svg").length).toBe(2);
    expect(queryByTestId(NO_VISION)).not.toBeNull();
  });

  it("renders the eye-off when the only capability is reasoning (no vision)", () => {
    const { container, queryByTestId } = render(
      <ModelCapabilityIcons capabilities={[ModelCapability.REASONING]} />
    );
    expect(container.querySelectorAll("svg").length).toBe(1);
    expect(queryByTestId(NO_VISION)).not.toBeNull();
  });
});

describe("hasCapabilityIcons", () => {
  it("is false for unknown (undefined) and vision-only models", () => {
    expect(hasCapabilityIcons(undefined)).toBe(false);
    expect(hasCapabilityIcons([ModelCapability.VISION])).toBe(false);
    expect(hasCapabilityIcons([ModelCapability.VISION, ModelCapability.REASONING])).toBe(false);
  });

  it("is true when an icon would render (no-vision or web search)", () => {
    expect(hasCapabilityIcons([])).toBe(true);
    expect(hasCapabilityIcons([ModelCapability.REASONING])).toBe(true);
    expect(hasCapabilityIcons([ModelCapability.WEB_SEARCH])).toBe(true);
    expect(hasCapabilityIcons([ModelCapability.VISION, ModelCapability.WEB_SEARCH])).toBe(true);
  });
});

describe("getModelDisplayWithIcons", () => {
  it("surfaces Websearch but never Vision or Reasoning", () => {
    const model: CustomModel = {
      name: "omni",
      provider: "openai",
      enabled: true,
      capabilities: [ModelCapability.VISION, ModelCapability.REASONING, ModelCapability.WEB_SEARCH],
    };
    const text = getModelDisplayWithIcons(model);
    expect(text).toContain("Websearch");
    expect(text).not.toContain("Vision");
    expect(text).not.toContain("Reasoning");
  });
});
