import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import type { App } from "obsidian";
import React from "react";
import { codexInstallState } from "./CodexBinaryManager";
import { updateCodexFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

/**
 * Codex card extras. The codex-acp install / path / auth configuration lives
 * in the Configure dialog (`CodexInstallModal`, opened via
 * `descriptor.openInstallUI`); this panel only hosts the spawn-time
 * environment-variable overrides that remain on the settings card.
 */
export const CodexSettingsPanel: React.FC<Props> = () => {
  const settings = useSettingsValue();
  const installState = codexInstallState(settings.agentMode?.backends?.codex);
  const details = installState.kind === "ready" ? installState.details : undefined;
  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      {details?.adapterVersion && details.cliVersion && (
        <div className="tw-flex tw-flex-col tw-gap-1 tw-text-xs tw-text-muted">
          <span>
            Adapter {details.adapterVersion} · Effective CLI {details.cliVersion} (
            {details.cliSource ?? "bundled"})
          </span>
          {details.warning && (
            <span className="tw-rounded tw-bg-callout-warning/20 tw-p-2 tw-text-warning">
              {details.warning}
            </span>
          )}
        </div>
      )}
      <EnvOverridesSetting
        backendDisplayName="Codex"
        value={settings.agentMode?.backends?.codex?.envOverrides}
        onChange={(next) => updateCodexFields({ envOverrides: next })}
        hintExamples={["CODEX_HOME", "OPENAI_BASE_URL"]}
      />
    </div>
  );
};
