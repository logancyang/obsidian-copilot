import { AGENT_MEMORY_FILE_NAME } from "@/agents/constants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { AlertTriangle } from "lucide-react";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";

export interface AgentClearMemoryConfirmProps {
  name: string;
  /** Vault-relative `memory/` folder, so the user can see what else goes. */
  memoryFolderPath: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Body of the clear-memory confirmation.
 *
 * It names the daily-notes folder as well as the file, because clearing only
 * the curated core would leave the next consolidation to write it straight back
 * from the notes — so the notes go too, and the user has to know that before
 * they confirm. See `designdocs/CUSTOM_AGENTS.md` §5 ("Settings and menus").
 */
export const AgentClearMemoryConfirmBody: React.FC<AgentClearMemoryConfirmProps> = ({
  name,
  memoryFolderPath,
  onCancel,
  onConfirm,
}) => (
  <div className="tw-flex tw-flex-col tw-gap-3">
    <div
      className={cn(
        "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-px-3.5 tw-py-2.5",
        "tw-border tw-border-solid tw-bg-modifier-error-rgb/15 tw-border-modifier-error/80"
      )}
    >
      <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-error" aria-hidden="true" />
      <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-normal">
        {name} starts over. {AGENT_MEMORY_FILE_NAME} is reset to its empty headings and every daily
        note moves to trash, so nothing can be rebuilt from them.
      </p>
    </div>

    <div className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-text-ui-smaller tw-text-muted">Will move to trash:</div>
      <ul className="tw-m-0 tw-list-none tw-space-y-1 tw-p-0 tw-font-mono tw-text-ui-smaller tw-text-normal">
        <li className="tw-flex tw-items-baseline tw-gap-2">
          <span className="tw-text-faint">•</span>
          <span className="tw-flex-1">
            {memoryFolderPath.replace(/\/+$/, "")}
            <span className="tw-ml-1.5 tw-font-sans tw-text-smallest tw-text-faint">
              every day of notes
            </span>
          </span>
        </li>
      </ul>
    </div>

    <div className="tw-flex tw-justify-end tw-gap-2 tw-pt-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="destructive" onClick={onConfirm}>
        Clear memory
      </Button>
    </div>
  </div>
);

/**
 * Native Obsidian confirm modal for clearing an agent's memory, built on the
 * same `Modal` host as the delete flow so both read as one dialog family.
 */
export class AgentClearMemoryConfirmModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly name: string,
    private readonly memoryFolderPath: string,
    private readonly onConfirmClear: () => void | Promise<void>
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle(`Clear ${name}'s memory?`);
  }

  onOpen() {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <AgentClearMemoryConfirmBody
        name={this.name}
        memoryFolderPath={this.memoryFolderPath}
        onCancel={() => this.close()}
        onConfirm={() => {
          const result = this.onConfirmClear();
          if (result instanceof Promise) {
            result.catch((error) => logError("[Agents] clear memory confirm failed", error));
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
