import { NEUTRAL_FACE_SRC } from "@/agents/customAgentFiles";
import { loadPresetFaces } from "@/agents/presetFaces";
import { AgentFace } from "@/agents/ui/AgentFace";
import { readAsDataUrl } from "@/agents/ui/AgentFacePicker";
import { Button } from "@/components/ui/button";
import { logWarn } from "@/logger";
import { setSettings, useSettingsValue } from "@/settings/model";
import { X } from "lucide-react";
import React, { useEffect, useState } from "react";

export interface FirstAgentBannerProps {
  onCreate: () => void;
  onDismiss: () => void;
}

export interface FirstAgentBannerViewProps extends FirstAgentBannerProps {
  faces: readonly string[];
}

const BANNER_FACE_COUNT = 3;
const NO_FACES: readonly string[] = Object.freeze([]);

export function useFirstAgentBannerVisible(agentCount: number): boolean {
  const dismissed = useSettingsValue().agentMode.firstTeammateBannerDismissed === true;
  // Once the first agent exists, however it was made, deleting it later does not bring the banner back.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  useEffect(() => {
    if (agentCount > 0 && !dismissed) dismissFirstAgentBanner();
  }, [agentCount, dismissed]);
  return agentCount === 0 && !dismissed;
}

export function dismissFirstAgentBanner(): void {
  setSettings((cur) => ({ agentMode: { ...cur.agentMode, firstTeammateBannerDismissed: true } }));
}

function useBannerFaces(): readonly string[] {
  const [faces, setFaces] = useState(NO_FACES);
  useEffect(() => {
    let mounted = true;
    void loadPresetFaces(BANNER_FACE_COUNT)
      .then((loaded) =>
        Promise.all(
          loaded.map((face) => readAsDataUrl(new Blob([face.bytes], { type: "image/webp" })))
        )
      )
      .then(
        (srcs) => {
          if (mounted) setFaces(srcs);
        },
        (error: unknown) => {
          // Without the preset faces, as when offline, the banner keeps its grey placeholder faces.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
          logWarn("[Custom agents] Could not load the first-agent banner's faces", error);
        }
      );
    return () => {
      mounted = false;
    };
  }, []);
  return faces;
}

export function FirstAgentBanner(props: FirstAgentBannerProps): React.ReactElement {
  return <FirstAgentBannerView {...props} faces={useBannerFaces()} />;
}

export function FirstAgentBannerView({
  faces,
  onCreate,
  onDismiss,
}: FirstAgentBannerViewProps): React.ReactElement {
  return (
    <div className="tw-relative tw-mt-3.5 tw-flex tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-py-3 tw-pl-3 tw-pr-9">
      <div className="tw-flex tw-shrink-0 tw-pt-0.5" aria-hidden="true">
        {Array.from({ length: BANNER_FACE_COUNT }, (_, index) => (
          <AgentFace
            key={index}
            src={faces[index] ?? NEUTRAL_FACE_SRC}
            size="m"
            className="tw-ring-2 tw-ring-[color:var(--background-primary)] [&:not(:first-child)]:-tw-ml-2.5"
          />
        ))}
      </div>
      <div className="tw-min-w-0 tw-flex-1">
        <div className="tw-text-ui-small tw-font-semibold tw-text-normal">
          Give each job its own teammate
        </div>
        <div className="tw-mb-2.5 tw-mt-1 tw-text-ui-smaller tw-text-muted">
          A teammate has its own instructions and remembers the rules you give it.
        </div>
        <Button size="sm" onClick={onCreate}>
          Create your first teammate
        </Button>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="clickable-icon tw-absolute tw-right-1.5 tw-top-1.5 tw-size-6 tw-p-1"
      >
        <X className="tw-size-3.5" />
      </button>
    </div>
  );
}
