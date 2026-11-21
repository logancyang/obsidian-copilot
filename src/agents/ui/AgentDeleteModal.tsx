import { NEUTRAL_FACE_SRC } from "@/agents/customAgentFiles";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { countOf } from "@/agents/ui/AgentProfileView";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Brain, FileText, ImageIcon } from "lucide-react";
import type { App } from "obsidian";
import React from "react";

export interface AgentDeleteFormProps {
  agent: Pick<CustomAgent, "name" | "instructionsPath" | "memoryPath" | "faceSrc">;
  memoryRules: number | null;
  chatCount: number;
  workingIn?: string | null;
  onDelete: () => void;
  onCancel: () => void;
}

const ICON_CLASS = "tw-mt-0.5 tw-size-3.5 tw-shrink-0 tw-text-muted";

export function AgentDeleteForm({
  agent,
  memoryRules,
  chatCount,
  workingIn,
  onDelete,
  onCancel,
}: AgentDeleteFormProps): React.ReactElement {
  const { name } = agent;
  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <div className="tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-error tw-bg-modifier-error-rgb/10 tw-px-3 tw-py-2 tw-text-ui-small tw-text-normal">
        <AlertTriangle className="tw-mt-0.5 tw-size-3.5 tw-shrink-0 tw-text-error" />
        <span>This deletes {name} and everything below. You can&apos;t undo it.</span>
      </div>
      {workingIn && (
        <p className="tw-m-0 tw-px-1 tw-text-ui-small tw-text-warning">
          {name} is working in {workingIn}&apos;s chat. Deleting stops it.
        </p>
      )}
      <ul className="tw-m-0 tw-list-none tw-divide-x-0 tw-divide-y tw-divide-solid tw-divide-border tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-0">
        <DeleteItem icon={<FileText className={ICON_CLASS} />} title={`What ${name} handles`}>
          <FilePath>{agent.instructionsPath}</FilePath>
        </DeleteItem>
        {/* MEMORY.md exists only after the agent's first save, and the dialog lists only what it deletes.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/940 */}
        {memoryRules !== null && (
          <DeleteItem
            icon={<Brain className={ICON_CLASS} />}
            title={`Rules ${name} remembers`}
            note={countOf(memoryRules, "rule")}
          >
            <FilePath>{agent.memoryPath}</FilePath>
          </DeleteItem>
        )}
        {/* An agent wearing the placeholder has no face file to delete.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/940 */}
        {agent.faceSrc !== NEUTRAL_FACE_SRC && (
          <DeleteItem icon={<ImageIcon className={ICON_CLASS} />} title={`${name}'s face`} />
        )}
      </ul>
      {chatCount > 0 && (
        <p className="tw-m-0 tw-px-1 tw-text-ui-small tw-text-muted">
          {countOf(chatCount, "chat")} with {name} will be archived, not deleted. You can find{" "}
          {chatCount === 1 ? "it" : "them"} under View archived.
        </p>
      )}
      <p className="tw-m-0 tw-px-1 tw-text-ui-small tw-text-muted">
        What {name} said in chats with other teammates stays there.
      </p>
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" autoFocus onClick={onCancel} className="tw-shrink-0">
          Cancel
        </Button>
        <Button variant="destructive" onClick={onDelete} className="tw-min-w-0">
          <span className="tw-truncate">Delete {name}</span>
        </Button>
      </div>
    </div>
  );
}

interface DeleteItemProps {
  icon: React.ReactNode;
  title: string;
  note?: string;
  children?: React.ReactNode;
}

function DeleteItem({ icon, title, note, children }: DeleteItemProps) {
  return (
    <li className="tw-flex tw-items-start tw-gap-2.5 tw-px-3 tw-py-2 tw-text-ui-small">
      {icon}
      <div className="tw-flex tw-min-w-0 tw-flex-col">
        <span>
          <span className="tw-font-semibold tw-text-normal">{title}</span>
          {note && <span className="tw-text-muted"> · {note}</span>}
        </span>
        {children}
      </div>
    </li>
  );
}

function FilePath({ children }: { children: string }) {
  return (
    <span className="tw-break-all tw-font-mono tw-text-ui-smaller tw-text-faint">{children}</span>
  );
}

export class AgentDeleteModal extends ReactModal {
  constructor(
    app: App,
    private readonly details: Omit<AgentDeleteFormProps, "onDelete" | "onCancel">,
    private readonly onDelete: () => void
  ) {
    super(app, `Delete ${details.agent.name}?`);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <AgentDeleteForm
        {...this.details}
        onCancel={close}
        onDelete={() => {
          close();
          this.onDelete();
        }}
      />
    );
  }
}
