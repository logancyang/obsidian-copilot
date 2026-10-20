import { addMiyoBadgeHosts, EMPTY_BADGE_HOSTS } from "@/miyo/miyoLinkBadges";
import { MiyoLinkBadge } from "@/miyo/ui/MiyoLinkBadge";
import { EMPTY_MIYO_PATHS } from "@/agentMode/ui/toolSummaries";
import { Markdown } from "@/components/Markdown";
import type { App } from "obsidian";
import React from "react";
import { createPortal } from "react-dom";

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
  const [badgeHosts, setBadgeHosts] = React.useState(EMPTY_BADGE_HOSTS);
  const miyoPathsKey = miyoPaths.join("\n");
  const markFoundLinks = React.useCallback(
    (container: HTMLElement) => {
      setBadgeHosts(
        miyoPathsKey
          ? addMiyoBadgeHosts(app, container, sourcePath, new Set(miyoPathsKey.split("\n")))
          : EMPTY_BADGE_HOSTS
      );
    },
    [app, sourcePath, miyoPathsKey]
  );
  return (
    <>
      <Markdown
        className="tw-p-1 tw-text-sm"
        sourcePath={sourcePath}
        text={text}
        onRendered={markFoundLinks}
      />
      {badgeHosts.map((host, i) => createPortal(<MiyoLinkBadge />, host, String(i)))}
    </>
  );
};
