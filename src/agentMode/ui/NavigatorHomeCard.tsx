import { useSessionsSidebarOpen } from "@/agentMode/ui/hooks/useSessionsSidebarOpen";
import { openSessionsSidebar } from "@/agentMode/ui/openSessionsSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { useIsPaidUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { PanelLeft, XIcon } from "lucide-react";
import type { App } from "obsidian";
import * as React from "react";

export interface NavigatorHomeCardProps {
  showPlusMarker: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

export function NavigatorHomeCard({
  showPlusMarker,
  onOpen,
  onDismiss,
}: NavigatorHomeCardProps): React.ReactElement {
  return (
    <section
      aria-label="New: Copilot Navigator"
      className="tw-relative tw-flex tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-py-2 tw-pl-3 tw-pr-9"
    >
      <PanelLeft aria-hidden="true" className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-muted" />
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-wrap tw-items-center tw-gap-x-3 tw-gap-y-2">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-basis-48 tw-flex-col tw-gap-0.5">
          <div className="tw-flex tw-items-center tw-gap-2">
            <span className="tw-text-ui-small tw-font-semibold tw-text-normal">
              New: Copilot Navigator
            </span>
            {showPlusMarker && (
              <Badge variant="outline" className="tw-shrink-0 tw-px-1.5 tw-py-0 tw-text-muted">
                Plus
              </Badge>
            )}
          </div>
          <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
            Keep every agent chat in one sidebar, grouped into Pinned, Projects and Recents, with
            live status.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={onOpen}>
          Open Copilot Navigator
        </Button>
      </div>
      <Button
        aria-label="Dismiss Copilot Navigator announcement"
        className="tw-absolute tw-right-1 tw-top-1"
        onClick={onDismiss}
        size="icon"
        variant="ghost2"
      >
        <XIcon aria-hidden="true" className="tw-size-4" />
      </Button>
    </section>
  );
}

export function useNavigatorHomeCardVisible(app: App): boolean {
  const dismissed = useSettingsValue().navigatorHomeCardDismissed;
  // The announcement shows until it is closed or used, and never beside an open Navigator it would point to.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/821
  return !useSessionsSidebarOpen(app) && !dismissed;
}

interface AgentHomeNavigatorCardProps {
  plugin: CopilotPlugin;
}

export function AgentHomeNavigatorCard({
  plugin,
}: AgentHomeNavigatorCardProps): React.ReactElement {
  const dismiss = () => updateSetting("navigatorHomeCardDismissed", true);
  return (
    <NavigatorHomeCard
      showPlusMarker={useIsPaidUser() === false}
      onDismiss={dismiss}
      onOpen={() => {
        // Using the announcement means it has done its job, also when it led to the upgrade dialog.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/821
        dismiss();
        openSessionsSidebar(plugin).catch((e) => logError("[AgentMode] open sidebar failed", e));
      }}
    />
  );
}
