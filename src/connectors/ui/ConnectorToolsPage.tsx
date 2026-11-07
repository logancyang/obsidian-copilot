import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import type { ServiceToolInfo } from "@/connectors/connectorTools";
import { ConnectorLogo } from "@/connectors/ui/ConnectorLogo";
import { Button } from "@/components/ui/button";
import { ClampedContent } from "@/components/ui/clamped-content";
import { SearchBar } from "@/components/ui/SearchBar";
import { humanizeToolName } from "@/lib/toolName";
import { SettingsSubPageLayout } from "@/settings/v2/components/ui/SettingsSubPageLayout";
import { CloudOff } from "lucide-react";
import React, { useMemo, useState } from "react";

const SEARCH_THRESHOLD = 8;

export interface ConnectorToolsPageProps {
  service: Pick<ConnectorCatalogEntry, "name" | "logoUrl">;
  tools: readonly ServiceToolInfo[] | null;
  onTryAgain: () => Promise<void>;
  onBack: () => void;
}

interface ReadableTool {
  key: string;
  name: string;
  description: string;
  readOnly: boolean;
}

export function ConnectorToolsPage({
  service,
  tools,
  onTryAgain,
  onBack,
}: ConnectorToolsPageProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const readable = useMemo(
    () => tools?.map((tool) => toReadableTool(tool, service.name)) ?? [],
    [tools, service.name]
  );
  const needle = query.trim().toLowerCase();
  const found = readable.filter(
    ({ name, description }) =>
      name.toLowerCase().includes(needle) || description.toLowerCase().includes(needle)
  );

  return (
    <SettingsSubPageLayout
      title={
        <span className="tw-flex tw-items-center tw-gap-2">
          <ConnectorLogo service={service} />
          {service.name} tools
        </span>
      }
      description={`What agents can do with ${service.name}.`}
      onBack={onBack}
      toolbar={
        readable.length > SEARCH_THRESHOLD && (
          <SearchBar value={query} onChange={setQuery} placeholder="Search tools" />
        )
      }
    >
      {tools === null ? (
        <Unreachable serviceName={service.name} onTryAgain={onTryAgain} />
      ) : found.length === 0 ? (
        <p className="tw-m-0 tw-py-8 tw-text-center tw-text-sm tw-text-muted">
          No tools match “{query.trim()}”
        </p>
      ) : (
        <>
          <ToolGroup title="Read only" tools={found.filter(({ readOnly }) => readOnly)} />
          <ToolGroup title="Can make changes" tools={found.filter(({ readOnly }) => !readOnly)} />
        </>
      )}
    </SettingsSubPageLayout>
  );
}

// A service names its tools for agents, may describe them in long markdown, and isn't bound to send text, so the page shows a title or the name in words, and the description's first paragraph as plain text.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/878
function toReadableTool(tool: ServiceToolInfo, serviceName: string): ReadableTool {
  const title = [tool.title, tool.annotations?.title].find(
    (candidate) => typeof candidate === "string" && candidate.trim()
  );
  const description = typeof tool.description === "string" ? tool.description.trim() : "";
  return {
    key: tool.name,
    name: title?.trim() ?? nameInWords(tool.name, serviceName),
    description: description.split(/\n\s*\n/)[0],
    readOnly: tool.annotations?.readOnlyHint === true,
  };
}

// Services such as Notion prefix every tool name with their own name, which the page title already gives.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/878
function nameInWords(toolName: string, serviceName: string): string {
  const words = humanizeToolName(toolName);
  const prefix = `${serviceName.toLowerCase()} `;
  return words.toLowerCase().startsWith(prefix)
    ? humanizeToolName(words.slice(prefix.length))
    : words;
}

interface ToolGroupProps {
  title: string;
  tools: readonly ReadableTool[];
}

function ToolGroup({ title, tools }: ToolGroupProps): React.ReactElement | null {
  if (tools.length === 0) return null;
  return (
    <section className="tw-py-3">
      <div
        role="heading"
        aria-level={3}
        className="tw-text-ui-smaller tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted"
      >
        {title} <span className="tw-font-normal">{tools.length}</span>
      </div>
      <ul className="tw-m-0 tw-list-none tw-p-0">
        {tools.map((tool) => (
          <li
            key={tool.key}
            className="tw-flex tw-flex-col tw-gap-0.5 tw-border-0 tw-border-b tw-border-solid tw-border-border tw-py-2.5 last:tw-border-b-0"
          >
            <div className="tw-text-ui-small tw-font-semibold tw-text-normal">{tool.name}</div>
            {tool.description && (
              <div className="tw-text-ui-smaller tw-text-muted">
                <ClampedContent collapsedClassName="tw-max-h-[2lh]">
                  {tool.description}
                </ClampedContent>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface UnreachableProps {
  serviceName: string;
  onTryAgain: () => Promise<void>;
}

function Unreachable({ serviceName, onTryAgain }: UnreachableProps): React.ReactElement {
  const [checking, setChecking] = useState(false);
  return (
    <section className="tw-flex tw-flex-col tw-items-center tw-gap-2 tw-px-4 tw-py-10 tw-text-center">
      <CloudOff aria-hidden="true" className="tw-size-6 tw-text-muted" />
      <div role="heading" aria-level={3} className="tw-text-base tw-font-semibold">
        Couldn&apos;t reach {serviceName}
      </div>
      <p className="tw-m-0 tw-max-w-sm tw-text-sm tw-text-muted">
        Copilot couldn&apos;t get its tools just now.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="tw-mt-2"
        disabled={checking}
        onClick={() => {
          setChecking(true);
          void onTryAgain().finally(() => setChecking(false));
        }}
      >
        Try again
      </Button>
    </section>
  );
}
