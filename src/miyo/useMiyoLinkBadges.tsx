import { addMiyoBadgeHosts, EMPTY_BADGE_HOSTS } from "@/miyo/miyoLinkBadges";
import { MiyoLinkBadge } from "@/miyo/ui/MiyoLinkBadge";
import type { App } from "obsidian";
import React from "react";
import { createPortal } from "react-dom";

export interface MiyoLinkBadges {
  markFoundLinks: (container: HTMLElement) => void;
  badges: React.ReactNode;
}

export function useMiyoLinkBadges(
  app: App,
  sourcePath: string,
  miyoPaths: readonly string[]
): MiyoLinkBadges {
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
  return {
    markFoundLinks,
    badges: badgeHosts.map((host, i) => createPortal(<MiyoLinkBadge />, host, String(i))),
  };
}
