import { EMPTY_MIYO_PATHS } from "@/miyo/agentMode/miyoSearchRun";
import { useMiyoLinkBadges } from "@/miyo/useMiyoLinkBadges";
import { Markdown } from "@/components/Markdown";
import { useSmoothedText } from "@/hooks/useSmoothedText";
import type { App } from "obsidian";
import React from "react";

interface AgentMarkdownTextProps {
  text: string;
  streaming?: boolean;
  app: App;
  miyoPaths?: readonly string[];
}

export const AgentMarkdownText: React.FC<AgentMarkdownTextProps> = ({
  text,
  streaming = false,
  app,
  miyoPaths = EMPTY_MIYO_PATHS,
}) => {
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  const { markFoundLinks, badges } = useMiyoLinkBadges(app, sourcePath, miyoPaths);
  const shown = useSmoothedText(text, streaming);
  return (
    <>
      <Markdown
        className="tw-p-1 tw-text-sm"
        sourcePath={sourcePath}
        text={shown}
        onRendered={markFoundLinks}
        runDataviewQueries
      />
      {badges}
    </>
  );
};
