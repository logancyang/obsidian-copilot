import React, { useState } from "react";
import { ToggleComponent } from "./SettingBlocks";
import { COMMAND_NAMES, DISABLEABLE_COMMANDS } from "@/constants";
import { isCommandEnabled } from "@/commands";

interface CommandToggleSettingsProps {
  enabledCommands: Record<string, { enabled: boolean }>;
  setEnabledCommands: (enabledCommands: Record<string, { enabled: boolean }>) => void;
}

const CommandToggleSettings: React.FC<CommandToggleSettingsProps> = ({
  enabledCommands,
  setEnabledCommands,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleCommand = (commandId: string, enabled: boolean) => {
    setEnabledCommands({
      ...enabledCommands,
      [commandId]: { ...enabledCommands[commandId], enabled },
    });
  };

  return (
    <div>
      <h2 onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: "pointer" }}>
        Command Settings {isExpanded ? "▼" : "▶"}
      </h2>
      {isExpanded && (
        <div>
          {DISABLEABLE_COMMANDS.map((commandId) => (
            <ToggleComponent
              key={commandId}
              name={COMMAND_NAMES[commandId]}
              // Default to true if the command is not in the enabledCommands object
              value={isCommandEnabled(commandId)}
              onChange={(value) => toggleCommand(commandId, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CommandToggleSettings;
