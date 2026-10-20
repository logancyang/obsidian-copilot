import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MIYO_ADD_FOLDER_DEEPLINK_URL, MIYO_DEEPLINK_URL } from "@/miyo/miyoUtils";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { ArrowUpRight, CheckSquare, CircleAlert, MonitorDown, RefreshCw } from "lucide-react";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";

export type ConnectStep = "guide" | "addVault";

export type ConnectOutcome = "connected" | "needs-add" | "unreachable" | "error";

const IconTile: React.FC<{ tone: "warning" | "info" | "success"; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <div
    className={cn(
      "tw-mb-3 tw-inline-flex tw-size-10 tw-items-center tw-justify-center tw-rounded-lg",
      tone === "warning" && "tw-bg-project-yellow tw-text-warning",
      tone === "info" && "tw-text-accent tw-bg-interactive-accent/20",
      tone === "success" && "tw-bg-project-green tw-text-project-green"
    )}
  >
    {children}
  </div>
);

interface MiyoConnectContentProps {
  step: ConnectStep;
  downloadUrl: string;
  canAutoAdd: boolean;
  onClose: () => void;
  onRetry: () => void;
  onAddVault: () => Promise<"added" | "manual" | "unreachable" | "error">;
}

export const MiyoConnectContent: React.FC<MiyoConnectContentProps> = ({
  step,
  downloadUrl,
  canAutoAdd,
  onClose,
  onRetry,
  onAddVault,
}) => {
  const [adding, setAdding] = React.useState(false);
  const [addError, setAddError] = React.useState(false);

  const handleAddVault = React.useCallback(async () => {
    setAddError(false);
    setAdding(true);
    const outcome = await onAddVault();
    setAdding(false);
    if (outcome === "error") {
      setAddError(true);
    }
  }, [onAddVault]);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {step === "guide" && (
        <>
          <div className="tw-flex tw-flex-col tw-gap-2">
            <IconTile tone="warning">
              <CircleAlert className="tw-size-5" />
            </IconTile>
            <div className="tw-text-lg tw-font-semibold tw-text-normal">
              Miyo isn&apos;t running
            </div>
            <div className="tw-text-sm tw-text-muted">
              Copilot couldn&apos;t reach a local Miyo instance. If you haven&apos;t installed Miyo
              yet, download it; if it&apos;s installed, open the app, then retry.
            </div>
          </div>
          <div className="tw-flex tw-gap-2">
            <Button
              variant="default"
              className="tw-flex-1 tw-justify-center"
              onClick={() => window.open(downloadUrl, "_blank")}
            >
              Download Miyo <ArrowUpRight className="tw-size-3.5" />
            </Button>
            <Button
              variant="secondary"
              className="tw-flex-1 tw-justify-center tw-border-none tw-shadow-none"
              onClick={() => window.open(MIYO_DEEPLINK_URL, "_blank")}
            >
              <MonitorDown className="tw-size-3.5" /> Open Miyo
            </Button>
          </div>
          <div className="tw-flex tw-items-center tw-justify-between">
            <Button variant="ghost2" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="link"
              size="sm"
              className="tw-border-none tw-bg-transparent tw-shadow-none"
              onClick={onRetry}
            >
              <RefreshCw className="tw-size-3.5" /> Retry connection
            </Button>
          </div>
        </>
      )}

      {step === "addVault" && (
        <>
          <div className="tw-flex tw-flex-col tw-gap-2">
            <IconTile tone="success">
              <CheckSquare className="tw-size-5" />
            </IconTile>
            <div className="tw-text-lg tw-font-semibold tw-text-normal">
              Register this vault with Miyo
            </div>
            <div className="tw-text-sm tw-text-muted">
              {canAutoAdd ? (
                <>
                  Miyo is running. Copilot will register{" "}
                  <span className="tw-font-semibold tw-text-normal">this vault</span> so Miyo can
                  index it locally for search and chat — unlimited, no credits. The folders you
                  register are the boundary Miyo works within; if you turn on Miyo&apos;s Relay
                  connector, ChatGPT and Claude can reach this vault too.
                </>
              ) : (
                <>
                  Miyo is running, but{" "}
                  <span className="tw-font-semibold tw-text-normal">this vault</span> isn&apos;t
                  added to it yet. Open Miyo, add this vault as a folder, then retry — Miyo indexes
                  it locally for search and chat, unlimited and no credits. If you turn on
                  Miyo&apos;s Relay connector, ChatGPT and Claude can reach it too.
                </>
              )}
            </div>
            {addError && (
              <div className="tw-text-sm tw-text-error">
                Couldn&apos;t register this vault with Miyo. Please try again.
              </div>
            )}
          </div>
          {canAutoAdd ? (
            <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={adding}
                onClick={() => void handleAddVault()}
              >
                {adding ? (
                  <>
                    <RefreshCw className="tw-size-3.5 tw-animate-spin" /> Registering…
                  </>
                ) : (
                  "Register & connect"
                )}
              </Button>
            </div>
          ) : (
            <>
              <div className="tw-flex tw-gap-2">
                <Button
                  variant="default"
                  className="tw-flex-1 tw-justify-center"
                  onClick={() => window.open(MIYO_ADD_FOLDER_DEEPLINK_URL, "_blank")}
                >
                  <MonitorDown className="tw-size-3.5" /> Open Miyo
                </Button>
              </div>
              <div className="tw-flex tw-items-center tw-justify-between">
                <Button variant="ghost2" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="tw-border-none tw-bg-transparent tw-shadow-none"
                  onClick={onRetry}
                >
                  <RefreshCw className="tw-size-3.5" /> Retry
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export interface MiyoConnectModalOptions {
  initialStep: ConnectStep;
  downloadUrl: string;
  canAutoAdd: boolean;
  onClose?: () => void;
  onRetry: () => Promise<ConnectOutcome>;
  onAddVault: () => Promise<"added" | "manual" | "unreachable" | "error">;
}

export class MiyoConnectModal extends Modal {
  private root: Root | null = null;
  private step: ConnectStep;

  constructor(
    app: App,
    private readonly options: MiyoConnectModalOptions
  ) {
    super(app);
    this.step = options.initialStep;
  }

  onOpen() {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.renderContent();
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
    this.options.onClose?.();
  }

  private advanceTo(step: ConnectStep): void {
    this.step = step;
    this.renderContent();
  }

  private renderContent(): void {
    this.root?.render(
      <MiyoConnectContent
        step={this.step}
        downloadUrl={this.options.downloadUrl}
        canAutoAdd={this.options.canAutoAdd}
        onClose={() => this.close()}
        onRetry={() => {
          void Promise.resolve(this.options.onRetry()).then((outcome) => {
            if (!this.root) {
              return;
            }
            if (outcome === "connected") {
              this.close();
            } else if (outcome === "needs-add") {
              this.advanceTo("addVault");
            } else if (outcome === "unreachable") {
              this.advanceTo("guide");
            }
          });
        }}
        onAddVault={async () => {
          const outcome = await this.options.onAddVault();
          if (this.root && outcome === "added") {
            this.close();
          } else if (this.root && outcome === "unreachable") {
            this.advanceTo("guide");
          }
          return outcome;
        }}
      />
    );
  }
}
