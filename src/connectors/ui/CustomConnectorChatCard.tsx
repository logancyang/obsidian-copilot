import {
  ensureConnectorsEntitlement,
  useIsConnectorsEnabled,
} from "@/connectors/connectorsEntitlement";
import type { CustomConnectors, CustomConnectorStatus } from "@/connectors/custom/customConnectors";
import {
  editableConfigText,
  secretNames,
  type CustomConnectorConfig,
} from "@/connectors/custom/customConnectorConfig";
import { ChatCard, ConnectedChatCard } from "@/connectors/ui/ConnectorChatCard";
import { ServerSummary } from "@/connectors/ui/CustomConnectorModal";
import { customStatusText } from "@/connectors/ui/CustomConnectorRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { navigateToPlusPage } from "@/plusUtils";
import { err2String } from "@/utils";
import { Notice } from "obsidian";
import React, { useState, useSyncExternalStore } from "react";

const NO_NAMES: readonly string[] = Object.freeze([]);
const NO_STORED_VALUES: ReadonlySet<string> = new Set();
const FIXABLE: ReadonlySet<CustomConnectorStatus["kind"]> = new Set([
  "couldnt-start",
  "unreachable",
  "key-not-accepted",
]);

export interface ProposedCustomConnector {
  readonly proposal: CustomConnectorConfig;
  readonly updates: string | null;
  readonly addedId: string | null;
}

export interface CustomConnectorChatCardProps {
  card: ProposedCustomConnector;
  customConnectors: CustomConnectors;
  onDismiss: () => void;
  onAdded: (connectorId: string) => void;
}

export function CustomConnectorChatCard({
  card,
  customConnectors,
  onDismiss,
  onAdded,
}: CustomConnectorChatCardProps): React.ReactElement {
  const app = useApp();
  const enabled = useIsConnectorsEnabled();
  const { connectors } = useSyncExternalStore(
    customConnectors.subscribe,
    customConnectors.getSnapshot
  );
  // The connector an earlier card added may have been removed in Settings since, and then this card adds it again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/871
  const target = connectors.some(({ config }) => config.id === card.updates) ? card.updates : null;

  const add = async (values: Readonly<Record<string, string>>) => {
    if (!(await ensureConnectorsEntitlement(app))) return;
    const text = editableConfigText(card.proposal, values);
    if (target) {
      customConnectors.edit(target, text);
      onAdded(target);
      return;
    }
    const parsed = customConnectors.parse(text);
    if (!parsed.ok) throw new Error(parsed.error);
    customConnectors.add(parsed.connectors);
    onAdded(parsed.connectors[0].config.id);
  };
  return (
    <CustomConnectorChatCardView
      proposal={card.proposal}
      locked={enabled === false}
      updating={target !== null}
      storedValueNames={target ? customConnectors.storedValueNames(target) : NO_STORED_VALUES}
      status={connectors.find(({ config }) => config.id === card.addedId)?.status ?? null}
      onAdd={(values) => {
        add(values).catch((error) => new Notice(err2String(error)));
      }}
      onDismiss={onDismiss}
      onSeePlans={() => navigateToPlusPage("connectors_chat")}
    />
  );
}

export interface CustomConnectorChatCardViewProps {
  proposal: CustomConnectorConfig;
  locked: boolean;
  updating: boolean;
  storedValueNames: ReadonlySet<string>;
  status: CustomConnectorStatus | null;
  onAdd: (values: Readonly<Record<string, string>>) => void;
  onDismiss: () => void;
  onSeePlans: () => void;
}

export function CustomConnectorChatCardView({
  proposal,
  locked,
  updating,
  storedValueNames,
  status,
  onAdd,
  onDismiss,
  onSeePlans,
}: CustomConnectorChatCardViewProps): React.ReactElement {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const { name } = proposal;

  if (locked) {
    return (
      <ChatCard
        service={proposal}
        tone="accent"
        title={`Add ${name} with Connectors`}
        detail={<span className="tw-text-muted">Connectors is a preview for Supporters.</span>}
        actions={
          <Button size="sm" onClick={onSeePlans}>
            See plans
          </Button>
        }
      />
    );
  }
  if (status?.kind === "connected") {
    return (
      <ConnectedChatCard>
        {name} connected with {status.toolCount} {status.toolCount === 1 ? "tool" : "tools"}. Every
        agent can use it now.
      </ConnectedChatCard>
    );
  }
  if (status) {
    const [tone, text] = customStatusText(status);
    return (
      <ChatCard
        service={proposal}
        tone={tone === "attention" ? "error" : "normal"}
        title={name}
        detail={
          <>
            <span
              className={cn(
                "tw-block tw-break-words",
                tone === "attention" ? "tw-text-error" : "tw-text-muted"
              )}
            >
              {text}
            </span>
            {FIXABLE.has(status.kind) && (
              <span className="tw-block tw-text-muted">
                Send a message and the agent can propose a fix.
              </span>
            )}
          </>
        }
        actions={null}
      />
    );
  }

  const names = secretNames(proposal);
  const ready = names.every((key) => values[key] || storedValueNames.has(key));
  // The command runs on the user's computer once they click, so the card shows all of it, never truncated.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/871
  return (
    <ChatCard
      service={proposal}
      title={updating ? "Update custom connector" : "Add custom connector"}
      detail={
        <>
          <span className="tw-block tw-font-semibold tw-text-normal">{name}</span>
          <span className="tw-text-muted">
            <ServerSummary config={proposal} missing={NO_NAMES} />
          </span>
        </>
      }
      actions={null}
      footer={
        <form
          className="tw-ml-12 tw-flex tw-flex-col tw-gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            onAdd(values);
            // A later proposal with the same name reuses this card, which must not still hold the key typed here.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/871
            setValues({});
          }}
        >
          {names.map((key) => (
            <label key={key} className="tw-flex tw-flex-col tw-gap-1 tw-text-ui-smaller">
              <span className="tw-break-all tw-font-mono tw-text-muted">{key}</span>
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={values[key] ?? ""}
                placeholder={
                  storedValueNames.has(key) ? "Leave blank to keep the stored value" : undefined
                }
                onChange={(event) => setValues({ ...values, [key]: event.target.value })}
              />
            </label>
          ))}
          <div className="tw-flex tw-justify-end tw-gap-1">
            <Button type="button" size="sm" variant="ghost2" onClick={onDismiss}>
              Not now
            </Button>
            <Button type="submit" size="sm" disabled={!ready}>
              {updating ? "Update" : "Add"}
            </Button>
          </div>
        </form>
      }
    />
  );
}
