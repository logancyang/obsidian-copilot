import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import type { App } from "obsidian";
import React from "react";
import { SimpleBackendSettingsPanel } from "@/agentMode/backends/_shared/SimpleBackendSettingsPanel";
import { ClaudeCodeInstallModal } from "./ClaudeCodeInstallModal";
import {
  CLAUDE_CODE_BINARY_NAME,
  CLAUDE_CODE_INSTALL_COMMAND,
  updateClaudeCodeFields,
} from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

export const ClaudeCodeSettingsPanel: React.FC<Props> = ({ app }) => (
  <SimpleBackendSettingsPanel
    displayName="Claude Code"
    binaryName={CLAUDE_CODE_BINARY_NAME}
    installCommand={CLAUDE_CODE_INSTALL_COMMAND}
    pathPlaceholder="/absolute/path/to/claude-agent-acp"
    customPathTitle="Custom claude-agent-acp path"
    customPathDescription="Point Agent Mode at the claude-agent-acp binary. Claude Code inherits auth from your local `claude auth login` credentials."
    readStoredPath={() => getSettings().agentMode?.backends?.["claude-code"]?.binaryPath ?? ""}
    persistPath={(path) => updateClaudeCodeFields({ binaryPath: path })}
    openInstallModal={() => new ClaudeCodeInstallModal(app).open()}
  />
);
