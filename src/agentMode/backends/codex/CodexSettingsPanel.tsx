import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import type { App } from "obsidian";
import React from "react";
import { SimpleBackendSettingsPanel } from "@/agentMode/backends/shared/SimpleBackendSettingsPanel";
import { CodexInstallModal } from "./CodexInstallModal";
import { CODEX_BINARY_NAME, CODEX_INSTALL_COMMAND, updateCodexFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

export const CodexSettingsPanel: React.FC<Props> = ({ app }) => (
  <SimpleBackendSettingsPanel
    displayName="Codex"
    binaryName={CODEX_BINARY_NAME}
    installCommand={CODEX_INSTALL_COMMAND}
    pathPlaceholder="/absolute/path/to/codex-acp"
    customPathTitle="Custom codex-acp path"
    customPathDescription="Point Agent Mode at the codex-acp binary. Codex inherits auth from your local `codex login` credentials, or from `OPENAI_API_KEY` / `CODEX_API_KEY` exported in your shell."
    readStoredPath={() => getSettings().agentMode?.backends?.codex?.binaryPath ?? ""}
    persistPath={(path) => updateCodexFields({ binaryPath: path })}
    openInstallModal={() => new CodexInstallModal(app).open()}
  />
);
