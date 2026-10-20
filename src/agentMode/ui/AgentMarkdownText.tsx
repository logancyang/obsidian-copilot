import { EMPTY_MIYO_PATHS } from "@/miyo/agentMode/miyoSearchRun";
import { useMiyoLinkBadges } from "@/miyo/useMiyoLinkBadges";
import { Markdown } from "@/components/Markdown";
import type { App } from "obsidian";
import React from "react";

interface AgentMarkdownTextProps {
  text: string;
  app: App;
  miyoPaths?: readonly string[];
}

export const AgentMarkdownText: React.FC<AgentMarkdownTextProps> = ({
  text,
  app,
  miyoPaths = EMPTY_MIYO_PATHS,
}) => {
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  const { markFoundLinks, badges } = useMiyoLinkBadges(app, sourcePath, miyoPaths);
  return (
    <>
      <Markdown
        className="tw-p-1 tw-text-sm"
        sourcePath={sourcePath}
        text={text}
        onRendered={markFoundLinks}
      />
      {badges}
    </>
  );
};
