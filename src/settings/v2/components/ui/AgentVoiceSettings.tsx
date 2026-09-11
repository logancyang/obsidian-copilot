import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

export interface AgentVoiceSettingsProps {
  enabled: boolean;
  serverUrl: string;
  /** Current credential, masked by the password field. Empty when unset. */
  credential: string;
  onEnabledChange: (enabled: boolean) => void;
  onServerUrlChange: (serverUrl: string) => void;
  onCredentialChange: (credential: string) => void;
}

/**
 * Presents the voice demo's connection settings without reading or writing
 * plugin state. The connection details only appear once the demo is turned
 * on, because they are useless — and confusing — while it is off.
 */
export const AgentVoiceSettings: React.FC<AgentVoiceSettingsProps> = ({
  enabled,
  serverUrl,
  credential,
  onEnabledChange,
  onServerUrlChange,
  onCredentialChange,
}) => (
  <>
    <SettingItem
      type="switch"
      title="Voice (demo)"
      description="Talk to the selected agent through the Copilot voice service. Desktop only, and available only to testers with a demo credential."
      checked={enabled}
      onCheckedChange={onEnabledChange}
    />
    {enabled && (
      <SettingItem
        type="text"
        title="Voice server URL"
        description="Base URL of the voice service, for example https://voice.example.com."
        value={serverUrl}
        placeholder="https://voice.example.com"
        onChange={onServerUrlChange}
      />
    )}
    {enabled && (
      <SettingItem
        type="password"
        title="Demo credential"
        description="Kept in your operating system keychain, never in the settings file that syncs between devices."
        value={credential}
        placeholder="Paste the credential you were given"
        onChange={onCredentialChange}
      />
    )}
  </>
);
