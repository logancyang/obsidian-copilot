import React from "react";
import { useSettingsContext } from "../contexts/SettingsContext";
import ApiSetting from "./ApiSetting";

const CopilotPlusSettings: React.FC = () => {
  const { settings, updateSettings } = useSettingsContext();

  return (
    <div>
      <br />
      <br />
      <h2>Copilot Plus (Alpha)</h2>
      <p>
        Copilot Plus brings powerful AI agent capabilities to Obsidian. Alpha access is limited to
        sponsors and early supporters. Learn more at{" "}
        <a href="https://obsidiancopilot.com" target="_blank" rel="noopener noreferrer">
          https://obsidiancopilot.com
        </a>
      </p>
      <ApiSetting
        title="License Key"
        description="Enter your Copilot Plus license key"
        value={settings.plusLicenseKey}
        setValue={(value) => updateSettings({ plusLicenseKey: value })}
        placeholder="Enter your license key"
      />
    </div>
  );
};

export default CopilotPlusSettings;
