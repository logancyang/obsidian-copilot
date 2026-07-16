import { render, screen } from "@testing-library/react";
import React from "react";
import { ModelSelector, type ModelSelectorEntry } from "./ModelSelector";

// The selector reads settings for its default model list + BYOK key check; a
// stub keeps the test to the closed-trigger rendering under test.
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => ({ activeModels: [] }),
  getModelKeyFromModel: (m: { name: string; provider: string }) => `${m.name}|${m.provider}`,
}));
jest.mock("@/utils", () => ({
  checkModelApiKey: () => ({ hasApiKey: true }),
  err2String: (e: unknown) => String(e),
}));
// Stub the warning icon to a testid — the real one wraps a Radix tooltip whose
// text only renders on hover, so we assert presence, not the tooltip copy. Also
// capture props to confirm the trigger passes stopPropagation=false (otherwise
// the icon becomes a dead zone over the button).
const cloudWarningProps: Array<{ stopPropagation?: boolean }> = [];
jest.mock("@/components/ui/SelfHostCloudWarningIcon", () => ({
  SelfHostCloudWarningIcon: (props: { stopPropagation?: boolean }) => {
    cloudWarningProps.push(props);
    return <span data-testid="cloud-warning" />;
  },
}));

const model = (over: Partial<ModelSelectorEntry>): ModelSelectorEntry => ({
  name: "gpt-5",
  provider: "openai",
  enabled: true,
  ...over,
});

describe("ModelSelector — closed-trigger self-host warning", () => {
  beforeEach(() => {
    cloudWarningProps.length = 0;
  });

  it("shows the cloud-egress warning on the collapsed trigger when the current model needs it", () => {
    const cloud = model({ _needsSelfHostWarning: true });
    render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[cloud]} />);

    // Rendered without opening the dropdown — the trigger itself carries it.
    expect(screen.getByTestId("cloud-warning")).toBeTruthy();
    // The trigger click must fall through to open the picker.
    expect(cloudWarningProps.some((p) => p.stopPropagation === false)).toBe(true);
  });

  it("does NOT show the warning when the current model is self-hostable", () => {
    const local = model({ _needsSelfHostWarning: false });
    render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[local]} />);

    expect(screen.queryByTestId("cloud-warning")).toBeNull();
  });
});
