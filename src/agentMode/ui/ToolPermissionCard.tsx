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
  /**
   * Name of the tool as the chat already shows it. Some agents send only the
   * tool's argument as the request title (OpenCode's web search sends the bare
   * query), which reads as if the query itself were a command.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/599
   */
  toolName?: string;
}

const EMPTY_OPTION_NAMES: readonly string[] = Object.freeze([]);
// Codex quotes the whole command prefix in its "don't ask again" option name, which can fill the card.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/618
const QUOTED_CODE = /\s*`([^`\n]+)`/;

interface OptionLabel {
  text: string;
  code?: string;
}

export const ToolPermissionCard: React.FC<ToolPermissionCardProps> = ({
  request,
  onResolve,
  toolName,
}) => {
  const { toolCall, options } = request;
  const [busy, setBusy] = useState(false);
  const orderedOptions = useMemo(() => sortOptions(options), [options]);
  const optionLabels = useMemo(
    () => orderedOptions.map((o) => splitOptionName(o.name)),
    [orderedOptions]
  );
  const optionNames = useMemo(
    () => disambiguateOptionNames(optionLabels.map((label) => label.text)),
    [optionLabels]
  );
  const diffContents = useMemo(() => extractDiffContents(toolCall.content), [toolCall.content]);
  const inputJson = useMemo(() => formatAgentInput(toolCall.rawInput), [toolCall.rawInput]);
  const title = toolCall.title ?? "Tool call";
  const namedTool =
    toolName && !title.toLowerCase().includes(toolName.toLowerCase()) ? toolName : undefined;

  const choose = (optionId: string) => {
    if (busy) return;
    setBusy(true);
    onResolve(toolCall.toolCallId, optionId);
  };

  return (
    <div className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary">
      <div className="copilot-divider-b tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2">
        <ShieldQuestion className="tw-size-4 tw-shrink-0 tw-text-accent" />
        <div className="tw-truncate tw-text-sm tw-font-medium">Permission required</div>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2 tw-px-3 tw-py-2">
        <p className="tw-m-0 tw-text-sm">
          {namedTool ? (
            <>
              Agent Mode wants to use <strong>{namedTool}</strong>: {title}.
            </>
          ) : (
            <>
              Agent Mode wants to run <strong>{title}</strong>.
            </>
          )}
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

      <div className="copilot-divider-t tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2 tw-px-3 tw-py-2">
        <TooltipProvider delayDuration={0}>
          {orderedOptions.map((option, index) => {
            const { code } = optionLabels[index];
            const button = (
              <Button
                key={option.optionId}
                variant={variantForKind(option.kind)}
                size="sm"
                className="tw-h-auto tw-min-h-6 tw-min-w-0 tw-max-w-full tw-whitespace-normal"
                disabled={busy}
                onClick={() => choose(option.optionId)}
              >
                <span className="tw-min-w-0 tw-break-words">{optionNames[index]}</span>
              </Button>
            );

            if (!option.description && !code) return button;

            return (
              <Tooltip key={option.optionId}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="tw-max-w-sm tw-whitespace-pre-wrap tw-break-words"
                >
                  {option.description}
                  {option.description && code ? "\n" : null}
                  {code ? <code>{code}</code> : null}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </div>
    </div>
  );
};

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

function sortOptions(options: PermissionOption[]): PermissionOption[] {
  return [...options].sort(
    (a, b) => PERMISSION_OPTION_KINDS.indexOf(a.kind) - PERMISSION_OPTION_KINDS.indexOf(b.kind)
  );
}

function splitOptionName(name: string): OptionLabel {
  const match = QUOTED_CODE.exec(name);
  if (!match) return { text: name };
  return { text: name.replace(match[0], "…").trim(), code: match[1] };
}

function disambiguateOptionNames(names: string[]): readonly string[] {
  if (names.length === 0) return EMPTY_OPTION_NAMES;

  const totals = new Map<string, number>();
  const suffixes = new Map<string, number>();
  const reservedNames = new Set(names);

  for (const name of names) {
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }

  return names.map((name) => {
    if (totals.get(name) === 1) return name;

    let suffix = (suffixes.get(name) ?? 0) + 1;
    while (reservedNames.has(`${name} ${suffix}`)) suffix++;
    suffixes.set(name, suffix);

    const numbered = `${name} ${suffix}`;
    reservedNames.add(numbered);
    return numbered;
  });
}
