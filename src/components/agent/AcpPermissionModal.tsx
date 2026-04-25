import { Button } from "@/components/ui/button";
import { extractDiffContents, formatAgentInput, renderDiff } from "@/components/agent/diffRender";
import {
  PermissionOption,
  PermissionOptionKind,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

interface ContentProps {
  request: RequestPermissionRequest;
  onChoose: (response: RequestPermissionResponse) => void;
}

/**
 * Map ACP `PermissionOptionKind` to a Button variant. Allow-once is the
 * primary action; reject variants are destructive; allow-always is also
 * default but with a subtle outline styling so the user has to think.
 */
function variantForKind(kind: PermissionOptionKind): "default" | "secondary" | "destructive" {
  switch (kind) {
    case "allow_once":
      return "default";
    case "allow_always":
      return "secondary";
    case "reject_once":
    case "reject_always":
      return "destructive";
  }
}

const PermissionContent: React.FC<ContentProps> = ({ request, onChoose }) => {
  const { toolCall, options } = request;
  const orderedOptions = React.useMemo(() => sortOptions(options), [options]);
  const diffContents = React.useMemo(
    () => extractDiffContents(toolCall.content),
    [toolCall.content]
  );
  const inputJson = React.useMemo(() => formatAgentInput(toolCall.rawInput), [toolCall.rawInput]);
  const title = toolCall.title ?? "Tool call";

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <p className="tw-text-sm">
        Agent Mode wants to run <strong>{title}</strong>.
      </p>
      {toolCall.kind ? (
        <p className="tw-text-xs tw-text-muted">
          Kind: <code>{toolCall.kind}</code>
        </p>
      ) : null}

      {diffContents.length > 0 ? (
        <div className="tw-flex tw-flex-col tw-gap-2">
          {diffContents.map((d, i) => (
            <div key={i} className="tw-rounded tw-border tw-border-border tw-p-2">
              <p className="tw-mb-1 tw-font-mono tw-text-xs tw-text-muted">{d.path}</p>
              <pre className="tw-max-h-48 tw-overflow-auto tw-whitespace-pre-wrap tw-text-xs">
                {renderDiff(d.oldText, d.newText)}
              </pre>
            </div>
          ))}
        </div>
      ) : inputJson ? (
        <details>
          <summary className="tw-cursor-pointer tw-text-xs tw-text-muted">Show inputs</summary>
          <pre className="tw-mt-1 tw-max-h-48 tw-overflow-auto tw-rounded tw-bg-secondary tw-p-2 tw-text-xs">
            {inputJson}
          </pre>
        </details>
      ) : null}

      <div className="tw-mt-1 tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
        {orderedOptions.map((opt) => (
          <Button
            key={opt.optionId}
            variant={variantForKind(opt.kind)}
            onClick={() => onChoose({ outcome: { outcome: "selected", optionId: opt.optionId } })}
          >
            {opt.name}
          </Button>
        ))}
      </div>
    </div>
  );
};

/**
 * Open the permission modal for one ACP `requestPermission` call. Resolves
 * with the `RequestPermissionResponse` to send back to the agent. Closing
 * the modal without choosing resolves with `outcome: "cancelled"`.
 */
export function openAcpPermissionModal(
  app: App,
  request: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
  return new Promise((resolve) => {
    const modal = new AcpPermissionModal(app, request, (response) => resolve(response));
    modal.open();
  });
}

class AcpPermissionModal extends Modal {
  private root: Root | null = null;
  private settled = false;

  constructor(
    app: App,
    private readonly request: RequestPermissionRequest,
    private readonly onSettle: (response: RequestPermissionResponse) => void
  ) {
    super(app);
    // @ts-expect-error - setTitle is part of Obsidian's Modal but missing from older type defs
    this.setTitle("Agent Mode — Permission required");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.root = createRoot(contentEl);
    this.root.render(
      <PermissionContent
        request={this.request}
        onChoose={(response) => {
          this.settled = true;
          this.onSettle(response);
          this.close();
        }}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.onSettle({ outcome: { outcome: "cancelled" } });
    }
  }
}

function sortOptions(options: PermissionOption[]): PermissionOption[] {
  // Show allow_once first (the safe default), then allow_always, then reject
  // variants. Keeps the most-used action under the user's mouse.
  const order: Record<PermissionOptionKind, number> = {
    allow_once: 0,
    allow_always: 1,
    reject_once: 2,
    reject_always: 3,
  };
  return [...options].sort((a, b) => order[a.kind] - order[b.kind]);
}
