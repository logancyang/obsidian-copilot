import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Textarea } from "@/components/ui/textarea";
import { setSettings, useSettingsValue } from "@/settings/model";
import { type StoredMcpServer, sanitizeStoredMcpServers } from "@/agentMode/session/mcpResolver";
import { Plus, Trash2 } from "lucide-react";
import React from "react";
import { v4 as uuidv4 } from "uuid";

const TRANSPORT_OPTIONS = [
  { label: "stdio (local command)", value: "stdio" },
  { label: "http", value: "http" },
  { label: "sse", value: "sse" },
];

/**
 * Settings UI for managing user-configured MCP servers. Servers are sent to
 * the agent on `session/new` (and resume/load); changes only affect newly
 * started sessions.
 */
export const McpServersPanel: React.FC = () => {
  const settings = useSettingsValue();
  const servers = React.useMemo(
    () => sanitizeStoredMcpServers(settings.agentMode.mcpServers),
    [settings.agentMode.mcpServers]
  );

  const persist = (next: StoredMcpServer[]) => {
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, mcpServers: next } }));
  };

  const update = (id: string, patch: Partial<StoredMcpServer>) => {
    persist(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const remove = (id: string) => {
    persist(servers.filter((s) => s.id !== id));
  };

  const add = () => {
    const fresh: StoredMcpServer = {
      id: uuidv4(),
      enabled: true,
      name: "",
      transport: "stdio",
      command: "",
      args: [],
      env: [],
    };
    persist([...servers, fresh]);
  };

  return (
    <div className="tw-space-y-3">
      <div>
        <div className="tw-text-base tw-font-semibold">MCP servers</div>
        <div className="tw-text-sm tw-text-muted">
          Tools the agent can call via the Model Context Protocol. Changes apply to new sessions.
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-4 tw-text-sm tw-text-muted">
          No MCP servers configured.
        </div>
      ) : (
        <div className="tw-space-y-3">
          {servers.map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              onChange={(patch) => update(server.id, patch)}
              onRemove={() => remove(server.id)}
            />
          ))}
        </div>
      )}

      <Button variant="secondary" size="sm" onClick={add}>
        <Plus className="tw-size-4" />
        Add MCP server
      </Button>
    </div>
  );
};

interface McpServerCardProps {
  server: StoredMcpServer;
  onChange: (patch: Partial<StoredMcpServer>) => void;
  onRemove: () => void;
}

/** Card row for a single MCP server: header (toggle/name/transport/remove) + transport-specific fields. */
const McpServerCard: React.FC<McpServerCardProps> = ({ server, onChange, onRemove }) => {
  return (
    <div className="tw-space-y-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-p-3">
      <div className="tw-flex tw-items-center tw-gap-2">
        <SettingSwitch
          checked={server.enabled}
          onCheckedChange={(checked) => onChange({ enabled: checked })}
        />
        <Input
          className="!tw-flex-1"
          placeholder="Server name (e.g. filesystem)"
          value={server.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <div className="tw-w-40">
          <ObsidianNativeSelect
            options={TRANSPORT_OPTIONS}
            value={server.transport}
            onChange={(e) =>
              onChange({ transport: e.target.value as StoredMcpServer["transport"] })
            }
          />
        </div>
        <Button variant="ghost2" size="icon" onClick={onRemove} title="Remove server">
          <Trash2 className="tw-size-4" />
        </Button>
      </div>

      {server.transport === "stdio" ? (
        <StdioFields server={server} onChange={onChange} />
      ) : (
        <HttpFields server={server} onChange={onChange} />
      )}
    </div>
  );
};

/** Inputs specific to the stdio transport: command, newline-delimited args, env key/value pairs. */
const StdioFields: React.FC<{
  server: StoredMcpServer;
  onChange: (patch: Partial<StoredMcpServer>) => void;
}> = ({ server, onChange }) => {
  const argsText = (server.args ?? []).join("\n");
  return (
    <div className="tw-space-y-2">
      <FieldRow label="Command">
        <Input
          placeholder="npx"
          value={server.command ?? ""}
          onChange={(e) => onChange({ command: e.target.value })}
        />
      </FieldRow>
      <FieldRow label="Arguments" hint="One per line">
        <Textarea
          rows={3}
          placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
          value={argsText}
          onChange={(e) =>
            onChange({
              args: e.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0),
            })
          }
        />
      </FieldRow>
      <FieldRow label="Environment">
        <KeyValueEditor
          rows={server.env ?? []}
          onChange={(env) => onChange({ env })}
          keyPlaceholder="VAR_NAME"
          valuePlaceholder="value"
        />
      </FieldRow>
    </div>
  );
};

/** Inputs specific to the http/sse transport: URL and request headers. */
const HttpFields: React.FC<{
  server: StoredMcpServer;
  onChange: (patch: Partial<StoredMcpServer>) => void;
}> = ({ server, onChange }) => {
  return (
    <div className="tw-space-y-2">
      <FieldRow label="URL">
        <Input
          placeholder="https://example.com/mcp"
          value={server.url ?? ""}
          onChange={(e) => onChange({ url: e.target.value })}
        />
      </FieldRow>
      <FieldRow label="Headers">
        <KeyValueEditor
          rows={server.headers ?? []}
          onChange={(headers) => onChange({ headers })}
          keyPlaceholder="Authorization"
          valuePlaceholder="Bearer …"
        />
      </FieldRow>
    </div>
  );
};

/** Two-column layout helper: left-aligned label (with optional hint) and right-side editor. */
const FieldRow: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="tw-grid tw-grid-cols-[120px_1fr] tw-items-start tw-gap-2">
    <div className="tw-pt-2">
      <div className="tw-text-sm tw-font-medium">{label}</div>
      {hint && <div className="tw-text-xs tw-text-muted">{hint}</div>}
    </div>
    <div>{children}</div>
  </div>
);

interface KeyValueRow {
  name: string;
  value: string;
}

/** Generic editable list of `{name, value}` rows used for env vars and HTTP headers. */
const KeyValueEditor: React.FC<{
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}> = ({ rows, onChange, keyPlaceholder, valuePlaceholder }) => {
  const updateRow = (index: number, patch: Partial<KeyValueRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };
  const addRow = () => {
    onChange([...rows, { name: "", value: "" }]);
  };

  return (
    <div className="tw-space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="tw-flex tw-items-center tw-gap-2">
          <Input
            className="!tw-flex-1"
            placeholder={keyPlaceholder}
            value={row.name}
            onChange={(e) => updateRow(index, { name: e.target.value })}
          />
          <Input
            className="!tw-flex-1"
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => updateRow(index, { value: e.target.value })}
          />
          <Button
            variant="ghost2"
            size="icon"
            onClick={() => removeRow(index)}
            title="Remove entry"
          >
            <Trash2 className="tw-size-4" />
          </Button>
        </div>
      ))}
      <Button variant="ghost2" size="sm" onClick={addRow}>
        <Plus className="tw-size-3" />
        Add
      </Button>
    </div>
  );
};
