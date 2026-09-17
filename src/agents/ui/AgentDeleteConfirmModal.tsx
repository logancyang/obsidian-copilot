import { AGENT_FILE_NAME, AGENT_MEMORY_FILE_NAME } from "@/agents/constants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { AlertTriangle } from "lucide-react";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";

export interface AgentDeleteConfirmProps {
  name: string;
  /** Vault-relative agent folder, so the user can see exactly what is going. */
  folderPath: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Body of the delete confirmation. It names the memory file explicitly: an
 * agent's memory is the part the user cannot recreate, and deleting the agent
 * takes it, so the dialog has to say so before they confirm.
 */
export const AgentDeleteConfirmBody: React.FC<AgentDeleteConfirmProps> = ({
  name,
  folderPath,
  onCancel,
  onConfirm,
}) => {
  const folder = folderPath.replace(/\/+$/, "");
  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <div
        className={cn(
          "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-px-3.5 tw-py-2.5",
          "tw-border tw-border-solid tw-bg-modifier-error-rgb/15 tw-border-modifier-error/80"
        )}
      >
        <AlertTriangle
          className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-error"
          aria-hidden="true"
        />
        <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-normal">
          Everything {name} remembers goes with it. The folder moves to trash, memory file included,
          and chats that used {name} keep their label but answer as Copilot.
        </p>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <div className="tw-text-ui-smaller tw-text-muted">Will move to trash:</div>
        <ul className="tw-m-0 tw-list-none tw-space-y-1 tw-p-0 tw-font-mono tw-text-ui-smaller tw-text-normal">
          {[
            { path: `${folder}/${AGENT_FILE_NAME}`, note: "instructions" },
            { path: `${folder}/${AGENT_MEMORY_FILE_NAME}`, note: "everything it remembers" },
          ].map(({ path, note }) => (
            <li key={path} className="tw-flex tw-items-baseline tw-gap-2">
              <span className="tw-text-faint">•</span>
              <span className="tw-flex-1">
                {path}
                <span className="tw-ml-1.5 tw-font-sans tw-text-smallest tw-text-faint">
                  {note}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2 tw-pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          Delete agent
        </Button>
      </div>
    </div>
  );
};

/**
 * Native Obsidian confirm modal for deleting an agent. Built on Obsidian's
 * `Modal` for popout-window safety, native header chrome, and ESC handling,
 * matching the Skills tab's delete flow.
 */
export class AgentDeleteConfirmModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly name: string,
    private readonly folderPath: string,
    private readonly onConfirmDelete: () => void | Promise<void>
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle(`Delete ${name}?`);
  }

  onOpen() {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <AgentDeleteConfirmBody
        name={this.name}
        folderPath={this.folderPath}
        onCancel={() => this.close()}
        onConfirm={() => {
          const result = this.onConfirmDelete();
          if (result instanceof Promise) {
            result.catch((error) => logError("[Agents] delete confirm failed", error));
          }
          this.close();
        }}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
  }
}
