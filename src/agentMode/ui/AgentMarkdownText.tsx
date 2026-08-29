import { Markdown } from "@/components/Markdown";
import type { App } from "obsidian";
import React from "react";

interface AgentMarkdownTextProps {
  text: string;
  app: App;
}

/** Applies Agent-trail typography and active-note link resolution to shared Markdown rendering. */
export const AgentMarkdownText: React.FC<AgentMarkdownTextProps> = ({ text, app }) => {
  // Resolve internal links against the active note so vaults with duplicate
  // basenames or heading-only links open the right file.
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  return <Markdown className="tw-p-1 tw-text-sm" sourcePath={sourcePath} text={text} />;
};
