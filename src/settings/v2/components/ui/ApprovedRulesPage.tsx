import type { ApprovedRule, ApprovedRuleStore } from "@/agentMode";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/SearchBar";
import { err2String } from "@/errorFormat";
import { cn } from "@/lib/utils";
import type CopilotPlugin from "@/main";
import React from "react";
import { SettingsSubPageLayout } from "./SettingsSubPageLayout";

export interface ApprovedRulesPageProps {
  agentName: string;
  store: ApprovedRuleStore;
  plugin: CopilotPlugin;
  onBack: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rules: ReadonlyArray<ApprovedRule> };

const NO_RULES: ReadonlyArray<ApprovedRule> = Object.freeze([]);

interface RemoveError {
  rule: ApprovedRule;
  message: string;
}

function describeScope(rule: ApprovedRule, agentName: string): string {
  switch (rule.appliesTo.kind) {
    case "agent":
      return `All ${agentName} chats`;
    case "folder":
      return `Chats in ${rule.appliesTo.path}`;
    case "file":
      return `Saved in ${rule.appliesTo.path}`;
  }
}

export const ApprovedRulesPage: React.FC<ApprovedRulesPageProps> = ({
  agentName,
  store,
  plugin,
  onBack,
}) => {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [query, setQuery] = React.useState("");
  // One removal at a time: two concurrent removals can rewrite the same settings file and lose one.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/865
  const [removing, setRemoving] = React.useState(false);
  const [removeError, setRemoveError] = React.useState<RemoveError | null>(null);

  React.useEffect(() => {
    store.list(plugin).then(
      (rules) => setState({ kind: "ready", rules }),
      (error: unknown) => setState({ kind: "error", message: err2String(error) })
    );
  }, [store, plugin]);

  const handleRemove = async (rule: ApprovedRule) => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await store.remove(plugin, rule);
      setState((cur) =>
        cur.kind === "ready"
          ? { kind: "ready", rules: cur.rules.filter((r) => r.id !== rule.id) }
          : cur
      );
    } catch (error) {
      // A failed removal leaves the rule in force, so it stays listed beside the reason.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/865
      setRemoveError({ rule, message: err2String(error) });
    } finally {
      setRemoving(false);
    }
  };

  const allRules = state.kind === "ready" ? state.rules : NO_RULES;
  const needle = query.trim().toLowerCase();
  const visibleRules = needle
    ? allRules.filter((rule) =>
        `${rule.allows}\n${describeScope(rule, agentName)}`.toLowerCase().includes(needle)
      )
    : allRules;

  return (
    <SettingsSubPageLayout
      title="Approved rules"
      description={
        <>
          Actions {agentName} may take without asking, saved when you chose an &ldquo;always&rdquo;
          option. Remove a rule to have {agentName} ask again.
        </>
      }
      onBack={onBack}
      toolbar={
        allRules.length > 0 && (
          <>
            <SearchBar value={query} onChange={setQuery} placeholder="Search approved rules…" />
            {removeError && (
              <div role="alert" className="tw-text-sm tw-text-error">
                Couldn&apos;t remove {removeError.rule.allows}. {removeError.message}
              </div>
            )}
          </>
        )
      }
    >
      {state.kind === "loading" && (
        <div className="tw-py-6 tw-text-center tw-text-sm tw-text-muted">
          Loading approved rules…
        </div>
      )}

      {state.kind === "error" && (
        // Unreadable rules must not look like an empty list, which would claim nothing is approved.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/865
        <div
          role="alert"
          className="tw-my-4 tw-rounded-md tw-border tw-border-solid tw-border-error tw-px-3 tw-py-2.5 tw-text-sm"
        >
          <div className="tw-font-semibold tw-text-error">
            Couldn&apos;t read {agentName}&apos;s approved rules.
          </div>
          <div className="tw-mt-0.5 tw-break-words tw-text-muted">{state.message}</div>
        </div>
      )}

      {state.kind === "ready" && allRules.length === 0 && (
        <div className="tw-py-6 tw-text-center tw-text-sm tw-text-muted">
          {agentName} has no approved rules.
        </div>
      )}

      {allRules.length > 0 &&
        (visibleRules.length > 0 ? (
          <ul className="tw-m-0 tw-list-none tw-p-0">
            {visibleRules.map((rule, index) => (
              <li
                key={rule.id}
                className={cn(
                  "tw-flex tw-items-center tw-justify-between tw-gap-3 tw-py-3",
                  index > 0 && "copilot-divider-t"
                )}
              >
                <div className="tw-min-w-0">
                  <div className="tw-break-words tw-font-mono tw-text-sm">{rule.allows}</div>
                  <div className="tw-break-words tw-text-xs tw-text-muted">
                    {describeScope(rule, agentName)}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={removing}
                  onClick={() => void handleRemove(rule)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="tw-py-6 tw-text-center tw-text-sm tw-text-muted">
            No rules match &ldquo;{query.trim()}&rdquo;.
          </div>
        ))}
    </SettingsSubPageLayout>
  );
};
