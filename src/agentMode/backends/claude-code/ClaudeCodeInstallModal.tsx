import { getSettings } from "@/settings/model";
import { App } from "obsidian";
import React from "react";
import { BinaryInstallModal } from "@/agentMode/backends/_shared/BinaryInstallContent";
import {
  CLAUDE_CODE_BINARY_NAME,
  CLAUDE_CODE_INSTALL_COMMAND,
  updateClaudeCodeFields,
} from "./descriptor";

export class ClaudeCodeInstallModal extends BinaryInstallModal {
  constructor(app: App) {
    super(app, {
      modalTitle: "Configure Claude Code (Agent backend)",
      binaryDisplayName: "Claude Code",
      binaryName: CLAUDE_CODE_BINARY_NAME,
      installCommand: CLAUDE_CODE_INSTALL_COMMAND,
      pathPlaceholder: "/absolute/path/to/claude-agent-acp",
      initialPath: getSettings().agentMode?.backends?.["claude-code"]?.binaryPath ?? "",
      description: (
        <>
          Claude Code uses the official <code>@agentclientprotocol/claude-agent-acp</code> adapter,
          which wraps the local <code>claude</code> CLI. It inherits your existing{" "}
          <code>claude auth login</code> credentials — no API key needed if you&apos;re already
          signed in.
        </>
      ),
      onPersist: (path) => updateClaudeCodeFields({ binaryPath: path }),
    });
  }
}
