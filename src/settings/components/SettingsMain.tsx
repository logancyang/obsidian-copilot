import React from "react";
import AdvancedSettings from "./AdvancedSettings";
import ApiSettings from "./ApiSettings";
import CopilotPlusSettings from "./CopilotPlusSettings";
import GeneralSettings from "./GeneralSettings";
import QASettings from "./QASettings";
import { resetSettings } from "@/settings/model";
import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";

const SettingsMain: React.FC = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        Copilot Settings
        <button onClick={() => new ResetSettingsConfirmModal(app, () => resetSettings()).open()}>
          Reset to Default Settings
        </button>
      </h1>

      <CopilotPlusSettings />
      <GeneralSettings />
      <ApiSettings />
      <QASettings />
      <AdvancedSettings />
    </div>
  );
};

export default SettingsMain;
