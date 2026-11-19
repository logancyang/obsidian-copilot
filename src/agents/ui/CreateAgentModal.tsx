import { customAgentsFolderPath, type CustomAgentStore } from "@/agents/CustomAgentStore";
import {
  CreateAgentCloseGuard,
  CreateAgentForm,
  type AgentModelChoices,
  type CreateAgentInitialValues,
} from "@/agents/ui/CreateAgentForm";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { Modal, type App } from "obsidian";
import React from "react";
import type { Root } from "react-dom/client";

export interface CreateAgentDialogOptions {
  store: CustomAgentStore;
  models: AgentModelChoices;
  initialValues?: CreateAgentInitialValues;
  onCreated: (slug: string) => void;
}

const OPEN_PICKER_SELECTOR = '[data-radix-popper-content-wrapper] > [data-state="open"]';

export class CreateAgentModal extends Modal {
  private root: Root | null = null;
  private readonly closeGuard = new CreateAgentCloseGuard();
  private closingForGood = false;

  constructor(
    app: App,
    private readonly options: CreateAgentDialogOptions
  ) {
    super(app);
    this.titleEl.setText("New agent");
  }

  onOpen(): void {
    this.containerEl.addEventListener("click", this.keepOpenOnOutsideClick, true);
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <CreateAgentDialog
        options={this.options}
        closeGuard={this.closeGuard}
        onCreated={(slug) => {
          this.closeForGood();
          this.options.onCreated(slug);
        }}
        onCancel={() => this.close()}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
  }

  // Esc, the close button and Cancel ask before throwing away what the user typed.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  close(): void {
    if (this.closingForGood || !this.closeGuard.hasInput) {
      super.close();
      return;
    }
    new ConfirmModal(
      this.app,
      () => this.closeForGood(),
      "",
      `Discard ${this.closeGuard.name || "this agent"}?`,
      "Discard",
      "Keep editing",
      undefined,
      "destructive"
    ).open();
  }

  // An open face or model picker takes Esc first, so Esc closes the picker instead of the dialog.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  onEscapeKey(evt: KeyboardEvent): void {
    if (this.modalEl.querySelector(OPEN_PICKER_SELECTOR)) return;
    evt.preventDefault();
    this.close();
  }

  private closeForGood(): void {
    this.closingForGood = true;
    this.close();
  }

  // A stray click outside must not lose a half-written agent, so it is ignored once anything is typed.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  private readonly keepOpenOnOutsideClick = (evt: MouseEvent): void => {
    if (this.closeGuard.hasInput && !this.modalEl.contains(evt.target as Node)) {
      evt.stopPropagation();
    }
  };
}

interface CreateAgentDialogProps {
  options: CreateAgentDialogOptions;
  closeGuard: CreateAgentCloseGuard;
  onCreated: (slug: string) => void;
  onCancel: () => void;
}

function CreateAgentDialog({ options, closeGuard, onCreated, onCancel }: CreateAgentDialogProps) {
  const agents = useCustomAgents(options.store);
  return (
    <TooltipProvider>
      <CreateAgentForm
        agents={agents}
        folderNames={options.store.folderNames()}
        agentsFolder={customAgentsFolderPath()}
        models={options.models}
        initialValues={options.initialValues}
        closeGuard={closeGuard}
        onCreate={async (agent) => onCreated(await options.store.createAgent(agent))}
        onClose={onCancel}
      />
    </TooltipProvider>
  );
}
