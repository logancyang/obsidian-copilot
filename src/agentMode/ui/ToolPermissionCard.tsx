import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { extractDiffContents, formatAgentInput, renderDiff } from "@/agentMode/ui/diffRender";
import type {
  PermissionOption,
  PermissionOptionKind,
  PermissionPrompt,
} from "@/agentMode/session/types";
import { PERMISSION_OPTION_KINDS } from "@/agentMode/session/types";
import { ShieldQuestion } from "lucide-react";
import React, { useMemo, useState } from "react";

interface ToolPermissionCardProps {
  request: PermissionPrompt;
  onResolve: (toolCallId: string, optionId: string) => void;
}

const EMPTY_OPTION_NAMES: readonly string[] = Object.freeze([]);

/**
 * Permission card rendered in the chat's action rail while a tool call is
 * awaiting the user's decision. Replaces the modal that
 * used to sit on top of every chat — modals are easy to dismiss by accident
 * (click-outside resolves as deny) and they steal focus across concurrent
 * sessions. The card stays visible until the user picks an option or the
 * turn is cancelled.
 *
 * The backend translates one-time and persistent decisions from the selected
 * `optionId`; this component only displays the domain prompt and forwards that
 * identifier.
 */
export const ToolPermissionCard: React.FC<ToolPermissionCardProps> = ({ request, onResolve }) => {
  const { toolCall, options } = request;
  const [busy, setBusy] = useState(false);
  const orderedOptions = useMemo(() => sortOptions(options), [options]);
  const optionNames = useMemo(() => disambiguateOptionNames(orderedOptions), [orderedOptions]);
  const diffContents = useMemo(() => extractDiffContents(toolCall.content), [toolCall.content]);
  const inputJson = useMemo(() => formatAgentInput(toolCall.rawInput), [toolCall.rawInput]);
  const title = toolCall.title ?? "Tool call";

  const choose = (optionId: string) => {
    if (busy) return;
    setBusy(true);
    onResolve(toolCall.toolCallId, optionId);
  };

  return (
    <div className="tw-mx-3 tw-my-2 tw-w-[calc(100%-1.5rem)] tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary">
      <div className="copilot-divider-b tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2">
        <ShieldQuestion className="tw-size-4 tw-shrink-0 tw-text-accent" />
        <div className="tw-truncate tw-text-sm tw-font-medium">Permission required</div>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2 tw-px-3 tw-py-2">
        <p className="tw-m-0 tw-text-sm">
          Agent Mode wants to run <strong>{title}</strong>.
        </p>
        {toolCall.kind ? (
          <p className="tw-m-0 tw-text-xs tw-text-muted">
            Kind: <code>{toolCall.kind}</code>
          </p>
        ) : null}

        {diffContents.length > 0 ? (
          <div className="tw-flex tw-flex-col tw-gap-2">
            {diffContents.map((d, i) => (
              <div
                // eslint-disable-next-line @eslint-react/no-array-index-key -- diff list is derived once per render from a snapshot; same path can appear multiple times
                key={`diff-${i}-${d.path}`}
                className="tw-rounded tw-border tw-border-solid tw-border-border tw-p-2"
              >
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
            <pre className="tw-mt-1 tw-max-h-48 tw-overflow-auto tw-rounded tw-bg-primary tw-p-2 tw-text-xs">
              {inputJson}
            </pre>
          </details>
        ) : null}
      </div>

      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 tw-border-t tw-border-solid tw-border-border tw-px-3 tw-py-2">
        <TooltipProvider delayDuration={0}>
          {orderedOptions.map((option, index) => {
            const button = (
              <Button
                key={option.optionId}
                variant={variantForKind(option.kind)}
                size="sm"
                className="tw-h-auto tw-min-h-6 tw-min-w-0 tw-max-w-full tw-whitespace-normal"
                disabled={busy}
                onClick={() => choose(option.optionId)}
              >
                <span className="tw-min-w-0 tw-break-all">{optionNames[index]}</span>
              </Button>
            );

            if (!option.description) return button;

            return (
              <Tooltip key={option.optionId}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="tw-max-w-sm tw-whitespace-pre-wrap tw-break-words"
                >
                  {option.description}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </div>
    </div>
  );
};

/**
 * Map `PermissionOptionKind` to a Button variant. "Once" actions stay neutral
 * so neither answer feels pre-selected. "Always" actions get visual weight
 * (accent for allow, red for deny) — those are the choices the user should
 * think harder about, since they persist beyond this turn.
 */
function variantForKind(kind: PermissionOptionKind): "default" | "secondary" | "destructive" {
  switch (kind) {
    case "allow_once":
    case "reject_once":
      return "secondary";
    case "allow_always":
      return "default";
    case "reject_always":
      return "destructive";
  }
}

/**
 * Show allow_once first (the safe default), then allow_always, then reject
 * variants. Keeps the most-used action under the user's mouse.
 */
function sortOptions(options: PermissionOption[]): PermissionOption[] {
  return [...options].sort(
    (a, b) => PERMISSION_OPTION_KINDS.indexOf(a.kind) - PERMISSION_OPTION_KINDS.indexOf(b.kind)
  );
}

function disambiguateOptionNames(options: PermissionOption[]): readonly string[] {
  if (options.length === 0) return EMPTY_OPTION_NAMES;

  const totals = new Map<string, number>();
  const suffixes = new Map<string, number>();
  const reservedNames = new Set(options.map((option) => option.name));

  for (const option of options) {
    totals.set(option.name, (totals.get(option.name) ?? 0) + 1);
  }

  return options.map((option) => {
    if (totals.get(option.name) === 1) return option.name;

    let suffix = (suffixes.get(option.name) ?? 0) + 1;
    while (reservedNames.has(`${option.name} ${suffix}`)) suffix++;
    suffixes.set(option.name, suffix);

    const name = `${option.name} ${suffix}`;
    reservedNames.add(name);
    return name;
  });
}
