import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AbortError,
  InstallOptions,
  ProgressEvent,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import type { OpencodeBinaryManager } from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { OPENCODE_PINNED_VERSION } from "@/constants";
import { App } from "obsidian";
import React from "react";

type ModalState =
  | { kind: "confirm" }
  | { kind: "running"; progress: ProgressEvent | null }
  | { kind: "success"; version: string; path: string }
  | { kind: "error"; message: string };

interface ContentProps {
  manager: OpencodeBinaryManager;
  hostPlatform: string;
  hostArch: string;
  pinnedVersion: string;
  destinationDir: string;
  onClose: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const phaseLabel = (e: ProgressEvent | null): string => {
  if (!e) return "Starting…";
  switch (e.phase) {
    case "resolve":
      return e.message;
    case "download":
      if (e.total) {
        const pct = Math.floor((e.received / e.total) * 100);
        return `Downloading ${e.assetName} — ${formatBytes(e.received)} / ${formatBytes(e.total)} (${pct}%)`;
      }
      return `Downloading ${e.assetName} — ${formatBytes(e.received)}`;
    case "extract":
      return e.message;
    case "done":
      return "Done";
  }
};

const phaseProgress = (e: ProgressEvent | null): number | undefined => {
  if (!e) return undefined;
  if (e.phase === "download" && e.total) {
    return Math.min(100, Math.floor((e.received / e.total) * 100));
  }
  if (e.phase === "extract") return 98;
  if (e.phase === "done") return 100;
  return undefined;
};

const OpencodeInstallContent: React.FC<ContentProps> = ({
  manager,
  hostPlatform,
  hostArch,
  pinnedVersion,
  destinationDir,
  onClose,
}) => {
  const [state, setState] = React.useState<ModalState>({ kind: "confirm" });
  const abortRef = React.useRef<AbortController | null>(null);

  const startInstall = React.useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "running", progress: null });

    const opts: InstallOptions = {
      signal: controller.signal,
      onProgress: (e) => setState({ kind: "running", progress: e }),
    };

    manager
      .install(opts)
      .then(({ version, path }) => setState({ kind: "success", version, path }))
      .catch((err: unknown) => {
        if (err instanceof AbortError || (err as Error)?.name === "AbortError") {
          // User cancelled — go back to confirm so they can retry.
          setState({ kind: "confirm" });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      });
  }, [manager]);

  const cancelInstall = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (state.kind === "confirm") {
    return (
      <div className="tw-flex tw-flex-col tw-gap-4">
        <p>
          opencode runs locally on your machine. The official binary will be downloaded from{" "}
          <code>github.com/sst/opencode/releases</code> over HTTPS and smoke-tested with{" "}
          <code>--version</code> before being activated.
        </p>
        <dl className="tw-grid tw-grid-cols-[max-content_1fr] tw-gap-x-4 tw-gap-y-1 tw-text-sm">
          <dt className="tw-text-muted">Platform</dt>
          <dd className="tw-font-mono">
            {hostPlatform}-{hostArch}
          </dd>
          <dt className="tw-text-muted">Version</dt>
          <dd className="tw-font-mono">v{pinnedVersion} (pinned)</dd>
          <dt className="tw-text-muted">Destination</dt>
          <dd className="tw-break-all tw-font-mono tw-text-xs">{destinationDir}</dd>
        </dl>
        <div className="tw-flex tw-justify-end tw-gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={startInstall}>
            Download & install
          </Button>
        </div>
      </div>
    );
  }

  if (state.kind === "running") {
    const pct = phaseProgress(state.progress);
    return (
      <div className="tw-flex tw-flex-col tw-gap-4">
        <p className="tw-text-sm">{phaseLabel(state.progress)}</p>
        <Progress value={pct ?? 0} />
        <div className="tw-flex tw-justify-end">
          <Button variant="ghost" onClick={cancelInstall}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (state.kind === "success") {
    return (
      <div className="tw-flex tw-flex-col tw-gap-4">
        <p>
          opencode <code>v{state.version}</code> installed successfully.
        </p>
        <p className="tw-break-all tw-font-mono tw-text-xs tw-text-muted">{state.path}</p>
        <div className="tw-flex tw-justify-end">
          <Button variant="default" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <p className="tw-text-error">Install failed.</p>
      <pre className="tw-max-h-32 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary tw-p-2 tw-text-xs">
        {state.message}
      </pre>
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="default" onClick={startInstall}>
          Retry
        </Button>
      </div>
    </div>
  );
};

export class OpencodeInstallModal extends ReactModal {
  constructor(
    app: App,
    private readonly manager: OpencodeBinaryManager,
    private readonly hostInfo: { platform: string; arch: string }
  ) {
    super(app, "Install opencode (BYOK Agent backend)");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <OpencodeInstallContent
        manager={this.manager}
        hostPlatform={this.hostInfo.platform}
        hostArch={this.hostInfo.arch}
        pinnedVersion={OPENCODE_PINNED_VERSION}
        destinationDir={this.manager.getDataDir()}
        onClose={close}
      />
    );
  }
}
