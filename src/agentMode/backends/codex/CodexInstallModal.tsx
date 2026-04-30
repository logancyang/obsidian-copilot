import { getSettings } from "@/settings/model";
import { App } from "obsidian";
import React from "react";
import { BinaryInstallModal } from "@/agentMode/backends/_shared/BinaryInstallContent";
import { CODEX_BINARY_NAME, CODEX_INSTALL_COMMAND, updateCodexFields } from "./descriptor";

export class CodexInstallModal extends BinaryInstallModal {
  constructor(app: App) {
    super(app, {
      modalTitle: "Configure Codex (Agent backend)",
      binaryDisplayName: "Codex",
      binaryName: CODEX_BINARY_NAME,
      installCommand: CODEX_INSTALL_COMMAND,
      pathPlaceholder: "/absolute/path/to/codex-acp",
      initialPath: getSettings().agentMode?.backends?.codex?.binaryPath ?? "",
      description: (
        <>
          Codex uses the official <code>@zed-industries/codex-acp</code> adapter, which wraps the
          local <code>codex</code> CLI. It inherits your existing <code>codex login</code>{" "}
          credentials — or set <code>OPENAI_API_KEY</code> / <code>CODEX_API_KEY</code> in your
          shell if you prefer API-key auth.
        </>
      ),
      onPersist: (path) => updateCodexFields({ binaryPath: path }),
    });
  }
}
