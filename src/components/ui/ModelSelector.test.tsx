import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ModelSelector } from "./ModelSelector";
import type { ModelSelectorEntry } from "./ModelSelector";
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

jest.mock("@/components/ui/LicenseRequiredIcon", () => ({
  LicenseRequiredIcon: () => <span data-testid="license-lock" />,
}));

const model = (over: Partial<ModelSelectorEntry>): ModelSelectorEntry => ({
  name: "gpt-5",
  provider: "openai",
  enabled: true,
  ...over,
});

describe("ModelSelector", () => {
  describe("ModelSelector()", () => {
    beforeEach(() => {
      cloudWarningProps.length = 0;
    });

    it("shows the cloud-egress warning on the collapsed trigger when the current model needs it", () => {
      const cloud = model({ _needsSelfHostWarning: true });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[cloud]} />);

      expect(screen.getByTestId("cloud-warning")).toBeTruthy();
      expect(cloudWarningProps.some((p) => p.stopPropagation === false)).toBe(true);
    });

    it("hides the warning when the current model is self-hostable", () => {
      const local = model({ _needsSelfHostWarning: false });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[local]} />);

      expect(screen.queryByTestId("cloud-warning")).toBeNull();
    });

    it("marks a licence-locked row with the lock and drops its right-side reason", async () => {
      const locked = model({
        name: "copilot-plus-flash",
        provider: "copilot-plus",
        displayName: "Copilot Plus Flash",
        _needsLicense: true,
        _disabledReason: "Copilot license required",
      });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[locked]} />);
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(await screen.findByTestId("license-lock")).toBeTruthy();
      // The lock carries the reason; a per-row label would repeat it down the group.
      expect(screen.queryByText("Copilot license required")).toBeNull();
    });

    it("renders a row's subtitle under its name and keeps it off the collapsed trigger", async () => {
      const described = model({
        displayName: "Copilot Plus Flash",
        _subtitle: "The default model: fastest responses and the most quota.",
      });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[described]} />);

      expect(
        screen.queryByText("The default model: fastest responses and the most quota.")
      ).toBeNull();

      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(
        await screen.findByText("The default model: fastest responses and the most quota.")
      ).toBeTruthy();
    });

    it("keeps the right-side reason for a row disabled for any other cause", async () => {
      const needsKey = model({ _disabledReason: "Add API key" });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[needsKey]} />);
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(await screen.findByText("Add API key")).toBeTruthy();
    });
  });
});
