import React, { useState } from 'react';
import { ToggleComponent } from './SettingBlocks';

interface CommandToggleSettingsProps {
  enabledCommands: Record<string, { enabled: boolean; name: string }>;
  setEnabledCommands: (enabledCommands: Record<string, { enabled: boolean; name: string }>) => void;
}

const CommandToggleSettings: React.FC<CommandToggleSettingsProps> = ({
  enabledCommands,
  setEnabledCommands,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleCommand = (commandId: string, enabled: boolean) => {
    setEnabledCommands({
      ...enabledCommands,
      [commandId]: { ...enabledCommands[commandId], enabled }
    });
  };

  return (
    <div>
      <h2 onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer' }}>
        Command Settings {isExpanded ? '▼' : '▶'}
      </h2>
      {isExpanded && (
        <div>
          {Object.entries(enabledCommands).map(([commandId, { enabled, name }]) => (
            <ToggleComponent
              key={commandId}
              name={`${name}`}
              value={enabled}
              onChange={(value) => toggleCommand(commandId, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CommandToggleSettings;