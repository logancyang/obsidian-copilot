import { Markdown } from "@/components/Markdown";
import { FullBleedReactModal } from "@/components/modals/ReactModal";
import {
  formatReleaseNotesForObsidian,
  requestReleaseNotesSince,
} from "@/components/release-update/releaseNotes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowUpCircle, ExternalLink, LoaderCircle } from "lucide-react";
import { App } from "obsidian";
import * as React from "react";

export const GITHUB_RELEASES_URL = "https://github.com/logancyang/obsidian-copilot/releases/latest";

const UPDATE_PLUGIN_URL = "obsidian://show-plugin?id=copilot";

export interface ReleaseNotes {
  body: string;
  htmlUrl: string;
  version: string;
}

export type ReleaseNotesDialogState =
  | { status: "loading" }
  | { status: "error" }
  | {
      releases: ReleaseNotes[];
      status: "ready";
    };

export interface ReleaseNotesDialogContentProps {
  onClose: () => void;
  state: ReleaseNotesDialogState;
}

export function ReleaseNotesDialogContent({
  onClose,
  state,
}: ReleaseNotesDialogContentProps): React.ReactElement {
  const releaseUrl = state.status === "ready" ? state.releases[0].htmlUrl : GITHUB_RELEASES_URL;

  return (
    <div className="tw-flex tw-h-[min(80vh,46rem)] tw-max-h-[calc(100vh-2rem)] tw-flex-col tw-overflow-hidden tw-text-normal">
      <header className="copilot-divider-b tw-flex tw-shrink-0 tw-items-center tw-gap-3 tw-bg-secondary tw-px-5 tw-py-4 tw-pr-12">
        <span className="tw-flex tw-size-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-interactive-accent tw-text-on-accent">
          <ArrowUpCircle aria-hidden="true" className="tw-size-5" />
        </span>
        <h2 className="tw-m-0 tw-text-ui-medium tw-font-semibold">Copilot update available</h2>
      </header>

      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-overscroll-contain tw-px-5 tw-py-4">
        {state.status === "ready" ? (
          state.releases.map((release, index) => (
            <Markdown
              className={cn(index > 0 && "copilot-divider-t tw-mt-6 tw-pt-2")}
              key={release.version}
              onRendered={formatReleaseNotesForObsidian}
              sourcePath=""
              text={release.body}
            />
          ))
        ) : state.status === "error" ? (
          <div
            aria-label="Couldn’t load release notes"
            className="tw-flex tw-h-full tw-items-center tw-justify-center"
            role="alert"
          >
            <div className="tw-flex tw-max-w-md tw-items-start tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-bg-callout-warning/20 tw-p-4 tw-border-warning/40">
              <AlertTriangle
                aria-hidden="true"
                className="tw-mt-0.5 tw-size-5 tw-shrink-0 tw-text-warning"
              />
              <div>
                <div className="tw-font-medium">Couldn’t load release notes</div>
                <p className="tw-mb-0 tw-mt-1 tw-text-ui-smaller tw-text-muted">
                  Check your connection or view the release on GitHub. You can still update Copilot
                  from Community Plugins.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="tw-flex tw-h-full tw-items-center tw-justify-center tw-gap-2 tw-text-ui-small tw-text-muted"
            role="status"
          >
            <LoaderCircle aria-hidden="true" className="tw-size-4 tw-animate-spin" />
            Loading release notes…
          </div>
        )}
      </div>

      <footer className="copilot-divider-t tw-flex tw-shrink-0 tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 tw-bg-secondary tw-px-5 tw-py-3">
        <Button asChild size="default" variant="secondary">
          <a href={releaseUrl} rel="noreferrer" target="_blank">
            View on GitHub
            <ExternalLink aria-hidden="true" className="tw-size-4" />
          </a>
        </Button>
        <Button asChild size="default">
          <a href={UPDATE_PLUGIN_URL} onClick={onClose} rel="noreferrer" target="_blank">
            Update in Obsidian
            <ExternalLink aria-hidden="true" className="tw-size-4" />
          </a>
        </Button>
      </footer>
    </div>
  );
}

interface SkippedReleaseNotesProps {
  currentVersion: string;
  latest: ReleaseNotes;
  onClose: () => void;
}

function SkippedReleaseNotes({
  currentVersion,
  latest,
  onClose,
}: SkippedReleaseNotesProps): React.ReactElement {
  const [releases, setReleases] = React.useState<ReleaseNotes[]>(() => [latest]);

  React.useEffect(() => {
    void requestReleaseNotesSince(currentVersion, latest).then(setReleases);
  }, [currentVersion, latest]);

  return <ReleaseNotesDialogContent onClose={onClose} state={{ status: "ready", releases }} />;
}

export class ReleaseNotesModal extends FullBleedReactModal {
  private readonly currentVersion: string;
  private readonly latest: ReleaseNotes;

  constructor(app: App, latest: ReleaseNotes, currentVersion: string) {
    super(app);
    this.latest = latest;
    this.currentVersion = currentVersion;
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <SkippedReleaseNotes
        currentVersion={this.currentVersion}
        latest={this.latest}
        onClose={close}
      />
    );
  }
}
