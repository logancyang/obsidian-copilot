import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { AgentVoiceSettings } from "./AgentVoiceSettings";

const NOOP_PROPS = {
  onEnabledChange: () => undefined,
  onServerUrlChange: () => undefined,
  onCredentialChange: () => undefined,
};

describe("AgentVoiceSettings", () => {
  it("hides the connection details while the voice demo is off", () => {
    render(<AgentVoiceSettings enabled={false} serverUrl="" credential="" {...NOOP_PROPS} />);

    expect(screen.getByText("Voice (demo)")).not.toBeNull();
    expect(screen.queryByText("Voice server URL")).toBeNull();
    expect(screen.queryByText("Demo credential")).toBeNull();
  });

  it("shows the server URL and a masked credential once the demo is on", () => {
    render(
      <AgentVoiceSettings
        enabled
        serverUrl="https://voice.example.com"
        credential="tester-credential"
        {...NOOP_PROPS}
      />
    );

    expect(screen.getByDisplayValue("https://voice.example.com")).not.toBeNull();
    const credentialField = screen.getByDisplayValue("tester-credential");
    expect(credentialField.getAttribute("type")).toBe("password");
  });

  it("reports the toggle change to its host", () => {
    const onEnabledChange = jest.fn();
    render(
      <AgentVoiceSettings
        enabled={false}
        serverUrl=""
        credential=""
        {...NOOP_PROPS}
        onEnabledChange={onEnabledChange}
      />
    );

    fireEvent.click(screen.getByRole("switch"));

    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });
});
