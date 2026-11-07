import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  secretNames,
  type CustomConnectorConfig,
  type CustomConnectorParse,
  type ParsedCustomConnector,
} from "@/connectors/custom/customConnectorConfig";
import { ConnectorRow } from "@/connectors/ui/ConnectorRow";
import { AlertCircle } from "lucide-react";
import { App } from "obsidian";
import React, { useMemo, useState } from "react";

const PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "…" }
    }
  }
}`;
const NO_STORED_VALUES: ReadonlySet<string> = new Set();

export interface CustomConnectorFormProps {
  helper: string;
  initialText?: string;
  storedValueNames?: ReadonlySet<string>;
  submitLabel: string;
  parse: (text: string) => CustomConnectorParse;
  onSubmit: (text: string, connectors: readonly ParsedCustomConnector[]) => void;
  onCancel: () => void;
}

export function CustomConnectorForm({
  helper,
  initialText = "",
  storedValueNames = NO_STORED_VALUES,
  submitLabel,
  parse,
  onSubmit,
  onCancel,
}: CustomConnectorFormProps): React.ReactElement {
  const [text, setText] = useState(initialText);
  const parsed = useMemo(() => (text.trim() ? parse(text) : null), [parse, text]);

  return (
    <form
      className="tw-flex tw-flex-col tw-gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed?.ok) onSubmit(text, parsed.connectors);
      }}
    >
      <p className="tw-m-0 tw-text-sm tw-text-muted">{helper}</p>
      <Textarea
        aria-label="Connector config"
        aria-invalid={parsed?.ok === false}
        value={text}
        autoFocus
        spellCheck={false}
        placeholder={PLACEHOLDER}
        className="tw-min-h-40 tw-font-mono placeholder:tw-text-faint"
        onChange={(event) => setText(event.target.value)}
      />
      {parsed?.ok === false && (
        <p
          role="alert"
          className="tw-m-0 tw-flex tw-items-start tw-gap-1.5 tw-text-sm tw-text-error"
        >
          <AlertCircle aria-hidden="true" className="tw-mt-0.5 tw-size-3.5 tw-shrink-0" />
          {parsed.error}
        </p>
      )}
      {parsed?.ok && (
        <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-p-0">
          {parsed.connectors.map(({ config, secrets }) => (
            <ConnectorRow
              key={config.id}
              service={config}
              detail={
                <ServerSummary
                  config={config}
                  missing={secretNames(config).filter(
                    (name) => !secrets[name] && !storedValueNames.has(name)
                  )}
                />
              }
            />
          ))}
        </ul>
      )}
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!parsed?.ok}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface ServerSummaryProps {
  config: CustomConnectorConfig;
  missing: readonly string[];
}

export function ServerSummary({ config, missing }: ServerSummaryProps): React.ReactElement {
  const values = secretNames(config).length;
  return (
    <>
      <span className="tw-block tw-break-all tw-font-mono">
        {"command" in config
          ? `Local · ${[config.command, ...config.args].join(" ")}`
          : `Remote · ${config.url}`}
      </span>
      {values > 0 && (
        <span className="tw-block">
          {values === 1 ? "1 value stays" : `${values} values stay`} in this device&apos;s keychain
        </span>
      )}
      {/* Saving with a value still blank kept "Add API key on this device" without saying which value was missing.
        https://github.com/Brevilabs/obsidian-copilot-private/issues/862 */}
      {missing.length > 0 && (
        <span className="tw-block tw-break-words tw-text-error">
          No value on this device: {missing.join(", ")}
        </span>
      )}
    </>
  );
}

export class CustomConnectorModal extends ReactModal {
  constructor(
    app: App,
    title: string,
    private readonly form: Omit<CustomConnectorFormProps, "onCancel">
  ) {
    super(app, title);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <CustomConnectorForm
        {...this.form}
        onSubmit={(text, connectors) => {
          this.form.onSubmit(text, connectors);
          close();
        }}
        onCancel={close}
      />
    );
  }
}
