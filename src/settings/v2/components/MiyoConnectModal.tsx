import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MIYO_ADD_FOLDER_DEEPLINK_URL, MIYO_DEEPLINK_URL } from "@/miyo/miyoUtils";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { ArrowUpRight, CheckSquare, CircleAlert, MonitorDown, RefreshCw } from "lucide-react";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";

/**
 * Which step of the connect flow is showing.
 *
 * - `guide`    — a probe couldn't reach Miyo; walks the user through starting it.
 * - `addVault` — Miyo is reachable but this vault isn't registered with it; asks
 *   the user to add the vault as a folder inside the Miyo app, then retry.
 *
 * Registration itself happens in the Miyo desktop app (Copilot has no register
 * API), so this step guides rather than performing a write.
 */
export type ConnectStep = "guide" | "addVault";

/**
 * Result of a connection attempt, driving the modal's next step.
 *
 * - `connected`   — reachable + registered; the caller already enabled Miyo, so
 *   the modal just closes.
 * - `needs-add`   — reachable but unregistered → show the `addVault` step.
 * - `unreachable` — no healthy Miyo → show the `guide` step.
 * - `error`       — couldn't determine registration (5xx / network); stay put,
 *   the caller surfaces a Notice.
 */
export type ConnectOutcome = "connected" | "needs-add" | "unreachable" | "error";

/** Accent icon tile framing the modal heading, tinted per step. */
const IconTile: React.FC<{ tone: "warning" | "info" | "success"; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <div
    className={cn(
      "tw-mb-3 tw-inline-flex tw-size-10 tw-items-center tw-justify-center tw-rounded-lg",
      // Warm-amber tile (not bg-warning, which skews orange/pink) framing the
      // orange CircleAlert — matches the design. Reuses the project-yellow tile
      // token (rgba(--color-yellow-rgb, .16)), the same soft-amber fill
      // ProjectIconTile uses, so it's a compiled, in-repo class rather than an
      // ad-hoc alpha utility Tailwind's JIT never emits.
      tone === "warning" && "tw-bg-project-yellow tw-text-warning",
      tone === "info" && "tw-text-accent tw-bg-interactive-accent/20",
      // Soft-green tile (same project-green pair ProjectIconTile uses) framing the
      // CheckSquare on the register step — matches the design's green success tile.
      tone === "success" && "tw-bg-project-green tw-text-project-green"
    )}
  >
    {children}
  </div>
);

interface MiyoConnectContentProps {
  step: ConnectStep;
  /** Download landing page for users without Miyo installed. */
  downloadUrl: string;
  /**
   * Whether this vault can be registered with one click from here — true for a
   * local Miyo whose absolute vault path we can resolve. When false (remote Miyo
   * / mobile), the addVault step falls back to the manual deeplink guidance.
   */
  canAutoAdd: boolean;
  onClose: () => void;
  /** Re-evaluate the connection. The hosting modal maps the outcome to a step. */
  onRetry: () => void;
  /**
   * Register this vault with Miyo (POST /v0/folder) and, on success, enable +
   * close. Resolves `"added"` when the modal should close, `"manual"` to fall
   * back to the deeplink guidance, `"unreachable"` when the folder registered but
   * Miyo couldn't be confirmed afterwards (route to the guide step, not a
   * register-failed message), or `"error"` to stay put with a message. Only
   * invoked from the addVault step when {@link canAutoAdd} is true.
   */
  onAddVault: () => Promise<"added" | "manual" | "unreachable" | "error">;
}

/**
 * Presentational content for the Connect flow, rendered inside
 * {@link MiyoConnectModal}. Exported separately from the `Modal` wrapper so it
 * can be unit-tested in jsdom without Obsidian's native modal chrome.
 */
export const MiyoConnectContent: React.FC<MiyoConnectContentProps> = ({
  step,
  downloadUrl,
  canAutoAdd,
  onClose,
  onRetry,
  onAddVault,
}) => {
  // Local to the addVault step: the one-click register is an async POST, so the
  // button shows progress and surfaces a failure inline rather than closing.
  const [adding, setAdding] = React.useState(false);
  const [addError, setAddError] = React.useState(false);

  const handleAddVault = React.useCallback(async () => {
    setAddError(false);
    setAdding(true);
    // The modal closes itself on "added"; on "manual"/"error" it stays open, so
    // clear the in-progress flag to re-enable the button for another try.
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
            // Local one-click: Cancel + primary register button, side by side
            // bottom-right (no Retry — a direct POST has nothing to re-probe).
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
            // Remote / mobile: can't one-click, so drop the user straight onto
            // Miyo's add-folder flow and keep Retry to re-check after they add the
            // folder there.
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
  /** Step to show when the modal first opens. */
  initialStep: ConnectStep;
  /** Download landing page for users without Miyo installed. */
  downloadUrl: string;
  /** Whether the addVault step can register with one click (local Miyo). */
  canAutoAdd: boolean;
  /** Called when the modal closes (Cancel, ESC, header X, or after connecting). */
  onClose?: () => void;
  /**
   * Re-evaluate the connection (probe + registration check). The resolved
   * {@link ConnectOutcome} advances/closes the same modal instance without a
   * close/reopen: `connected` closes, `needs-add`/`unreachable` switch step,
   * `error` stays put.
   */
  onRetry: () => Promise<ConnectOutcome>;
  /**
   * One-click register from the addVault step. On `"added"` the modal closes; on
   * `"manual"` it drops to the deeplink guidance; on `"unreachable"` (folder
   * registered but Miyo couldn't be confirmed) it advances to the guide step; on
   * `"error"` it stays put and the content surfaces a retry message.
   */
  onAddVault: () => Promise<"added" | "manual" | "unreachable" | "error">;
}

/**
 * Native Obsidian modal hosting {@link MiyoConnectContent}. Built on Obsidian's
 * `Modal` (not the Radix `Dialog`) for popout-window safety, native header
 * chrome, and ESC handling — see `src/agentMode/CLAUDE.md` (Modals section).
 *
 * The modal owns the step transitions so Retry can move between guide/addVault
 * (or close on success) inside the same native modal instance.
 */
export class MiyoConnectModal extends Modal {
  private root: Root | null = null;
  private step: ConnectStep;

  constructor(
    app: App,
    private readonly options: MiyoConnectModalOptions
  ) {
    super(app);
    this.step = options.initialStep;
    // setTitle is intentionally omitted — the body's IconTile + heading serve as
    // the title, matching the other headerless settings modals and the design
    // (a plain content dialog, no native title bar).
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
            // A slow probe can resolve after the user closed the modal (root
            // cleared in onClose); only act while still open.
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
            // "error": stay on the current step; the caller surfaced a Notice.
          });
        }}
        onAddVault={async () => {
          const outcome = await this.options.onAddVault();
          // Only act while still open (a slow POST can resolve post-close).
          if (this.root && outcome === "added") {
            this.close();
          } else if (this.root && outcome === "unreachable") {
            // The folder registered, but Miyo couldn't be confirmed afterwards.
            // Mirror attemptConnection's "unreachable" handling — send the user to
            // the guide (start Miyo, retry) rather than a false "couldn't register".
            this.advanceTo("guide");
          }
          return outcome;
        }}
      />
    );
  }
}
