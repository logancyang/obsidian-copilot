import {
  formatReleaseNotesForObsidian,
  GITHUB_RELEASES_URL,
  loadLatestReleaseNotes,
  type ReleaseNotes,
} from "@/components/release-update/releaseNotes";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { AlertTriangle, ArrowUpCircle, ExternalLink, LoaderCircle } from "lucide-react";
import { App, Component } from "obsidian";
import * as React from "react";

const UPDATE_PLUGIN_URL = "obsidian://show-plugin?id=copilot";

export const RELEASE_NOTES_MODAL_CLASS = "copilot-release-notes-modal";
export const RELEASE_NOTES_MODAL_CLASS_NAME = cn(
  RELEASE_NOTES_MODAL_CLASS,
  "tw-max-h-[calc(100vh-2rem)] tw-w-[min(46rem,calc(100vw-2rem))] tw-min-w-0 tw-max-w-[calc(100vw-2rem)] tw-overflow-hidden tw-p-0",
  "[&_.modal-content]:tw-p-0 [&_.modal-header]:tw-mb-0 [&_.modal-title]:tw-hidden"
);

export type ReleaseNotesDialogState =
  | { status: "loading" }
  | { status: "error" }
  | {
      release: ReleaseNotes;
      status: "ready";
    };

export interface ReleaseNotesDialogContentProps {
  onClose: () => void;
  state: ReleaseNotesDialogState;
}

export interface ReleaseNotesDialogProps {
  loadReleaseNotes?: () => Promise<ReleaseNotes>;
  onClose: () => void;
}

interface ReleaseNotesMarkdownProps {
  body: string;
}

function ReleaseNotesMarkdown({ body }: ReleaseNotesMarkdownProps): React.ReactElement {
  const app = useApp();
  const targetRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const component = new Component();
    component.load();
    target.classList.add("markdown-rendered");
    target.replaceChildren();

    // Rendering the API's raw body keeps durable attachment URLs and native
    // Obsidian typography. https://github.com/Brevilabs/obsidian-copilot-private/issues/317
    void renderMarkdown(app, formatReleaseNotesForObsidian(body), target, "", component).catch(
      (error: unknown) => {
        logWarn("[ReleaseNotesDialog] markdown render failed", error);
      }
    );

    return () => {
      component.unload();
      target.replaceChildren();
    };
  }, [app, body]);

  return (
    <div
      className={cn(
        "tw-min-w-0 tw-text-normal",
        "[&>*:first-child]:tw-mt-0 [&>*:last-child]:tw-mb-0",
        "[&_a]:tw-break-words",
        "[&_img]:tw-mx-auto [&_img]:tw-block [&_img]:tw-h-auto [&_img]:tw-max-w-full [&_img]:tw-rounded-md"
      )}
      ref={targetRef}
    />
  );
}

/**
 * Presents release content and update actions inside an Obsidian-hosted modal.
 * Network loading and modal lifecycle stay outside this prop-driven boundary.
 */
export function ReleaseNotesDialogContent({
  onClose,
  state,
}: ReleaseNotesDialogContentProps): React.ReactElement {
  // The shell and update action remain usable while notes load, so a slow
  // image or API response cannot trap the user. https://github.com/Brevilabs/obsidian-copilot-private/issues/317
  const releaseUrl = state.status === "ready" ? state.release.htmlUrl : GITHUB_RELEASES_URL;

  return (
    <div className="tw-flex tw-flex-col tw-overflow-hidden tw-text-normal">
      <header className="copilot-divider-b tw-flex tw-items-center tw-gap-3 tw-bg-secondary tw-px-5 tw-py-4 tw-pr-12">
        <span className="tw-flex tw-size-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-interactive-accent tw-text-on-accent">
          <ArrowUpCircle aria-hidden="true" className="tw-size-5" />
        </span>
        <h2 className="tw-m-0 tw-text-ui-medium tw-font-semibold">Copilot update available</h2>
      </header>

      <div className="tw-h-[min(65vh,38rem)] tw-overflow-y-auto tw-overscroll-contain tw-px-5 tw-py-4">
        {state.status === "ready" ? (
          <ReleaseNotesMarkdown body={state.release.body} />
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

      <footer className="copilot-divider-t tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 tw-bg-secondary tw-px-5 tw-py-3">
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

/** Loads the latest release while keeping the visible dialog shell stable. */
export function ReleaseNotesDialog({
  loadReleaseNotes = loadLatestReleaseNotes,
  onClose,
}: ReleaseNotesDialogProps): React.ReactElement {
  const [state, setState] = React.useState<ReleaseNotesDialogState>({ status: "loading" });

  React.useEffect(() => {
    // Release-note availability must never block the store path; network
    // failures become an in-dialog fallback. https://github.com/Brevilabs/obsidian-copilot-private/issues/317
    void loadReleaseNotes()
      .then((release) => setState({ status: "ready", release }))
      .catch((error: unknown) => {
        logWarn("[ReleaseNotesDialog] release notes request failed", error);
        setState({ status: "error" });
      });
  }, [loadReleaseNotes]);

  return <ReleaseNotesDialogContent onClose={onClose} state={state} />;
}

/**
 * Owns the native Obsidian modal lifecycle for release notes while leaving
 * fetching and rendering behavior inside the testable React boundary.
 */
export class ReleaseNotesModal extends ReactModal {
  /**
   * @param app - Obsidian app that owns the modal and its Markdown renderer.
   * @param loadReleaseNotes - Loader used to retrieve the release shown after opening.
   */
  constructor(
    app: App,
    private readonly loadReleaseNotes: () => Promise<ReleaseNotes> = loadLatestReleaseNotes
  ) {
    super(app, undefined, RELEASE_NOTES_MODAL_CLASS_NAME);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <ReleaseNotesDialog loadReleaseNotes={this.loadReleaseNotes} onClose={close} />;
  }
}
