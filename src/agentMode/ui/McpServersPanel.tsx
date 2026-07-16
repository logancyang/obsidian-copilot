import { McpServerModal } from "@/agentMode/ui/McpServerModal";
import { type StoredMcpServer, sanitizeStoredMcpServers } from "@/agentMode/session/mcpResolver";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { setSettings, useSettingsValue } from "@/settings/model";
import { Pencil, Plus, Trash2 } from "lucide-react";
import React from "react";
import { v4 as uuidv4 } from "uuid";

/** A fresh, unpersisted draft used to seed the "Add MCP server" modal. */
function blankServer(): StoredMcpServer {
  return {
    id: uuidv4(),
    enabled: true,
    name: "",
    transport: "stdio",
    command: "",
    args: [],
    env: [],
  };
}

/**
 * Settings UI for managing user-configured MCP servers. Servers are sent to
 * the agent on `session/new` (and resume/load); changes only affect newly
 * started sessions.
 *
 * The list renders read-only rows. Add/Edit happen in a native Obsidian modal
 * that edits a local draft and only persists on Save, so cancelling never
 * leaves a half-configured server behind. Enable/disable and delete act
 * directly from the row.
 */
export const McpServersPanel: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();
  const servers = React.useMemo(
    () => sanitizeStoredMcpServers(settings.agentMode.mcpServers),
    [settings.agentMode.mcpServers]
  );

  // Always reduce against the freshest persisted list (re-sanitized inside the
  // updater), never a render-time snapshot. The modal captures `upsert` when it
  // opens; if the user toggles or deletes another row while it's open, a
  // snapshot-based write would silently clobber that change on Save.
  const persist = (reduce: (current: StoredMcpServer[]) => StoredMcpServer[]) => {
    setSettings((cur) => ({
      agentMode: {
        ...cur.agentMode,
        mcpServers: reduce(sanitizeStoredMcpServers(cur.agentMode.mcpServers)),
      },
    }));
  };

  // Add (new id) or replace (existing id) in one path — the modal owns both.
  const upsert = (server: StoredMcpServer) => {
    persist((current) =>
      current.some((s) => s.id === server.id)
        ? current.map((s) => (s.id === server.id ? server : s))
        : [...current, server]
    );
  };

  const setEnabled = (id: string, enabled: boolean) => {
    persist((current) => current.map((s) => (s.id === id ? { ...s, enabled } : s)));
  };

  const remove = (id: string) => {
    persist((current) => current.filter((s) => s.id !== id));
  };

  const openAdd = () => {
    new McpServerModal(app, blankServer(), "add", upsert).open();
  };

  const openEdit = (server: StoredMcpServer) => {
    new McpServerModal(app, server, "edit", upsert).open();
  };

  return (
    <div className="tw-space-y-3">
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
        <div className="tw-space-y-1">
          <div className="tw-text-xs tw-font-semibold tw-text-muted">MCP servers</div>
          <div className="tw-text-sm tw-text-muted">
            Tools the agent can call via the Model Context Protocol. Changes apply to new sessions.
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={openAdd} className="tw-shrink-0">
          <Plus className="tw-size-4" />
          Add server
        </Button>
      </div>

      {servers.length === 0 ? (
        <div className="tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-4 tw-text-sm tw-text-muted">
          No MCP servers configured.
        </div>
      ) : (
        <div className="tw-space-y-2">
          {servers.map((server) => (
            <McpServerRow
              key={server.id}
              server={server}
              onToggle={(enabled) => setEnabled(server.id, enabled)}
              onEdit={() => openEdit(server)}
              onRemove={() => remove(server.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface McpServerRowProps {
  server: StoredMcpServer;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}

/** Read-only summary row for one MCP server. Edits go through the modal. */
const McpServerRow: React.FC<McpServerRowProps> = ({ server, onToggle, onEdit, onRemove }) => {
  const subtitle =
    server.transport === "stdio"
      ? [server.command ?? "", ...(server.args ?? [])].join(" ").trim()
      : (server.url ?? "");

  return (
    <div className="tw-flex tw-items-center tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3 tw-shadow-sm">
      {/* Toggle stays full-opacity and interactive even when the server is disabled. */}
      <SettingSwitch
        checked={server.enabled}
        onCheckedChange={onToggle}
        aria-label={`Enable ${server.name || "server"}`}
      />

      <div
        className={cn(
          "tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-3",
          !server.enabled && "tw-opacity-50"
        )}
      >
        <div className="tw-min-w-0 tw-flex-1">
          <div className="tw-flex tw-items-center tw-gap-2">
            <span className="tw-truncate tw-font-medium tw-text-normal">
              {server.name || "Unnamed server"}
            </span>
            <Badge variant="outline" className="tw-shrink-0">
              {server.transport}
            </Badge>
          </div>
          {subtitle && (
            <div className="tw-truncate tw-font-mono tw-text-xs tw-text-muted">{subtitle}</div>
          )}
        </div>

        <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
          <Button variant="ghost2" size="icon" onClick={onEdit} title="Edit server">
            <Pencil className="tw-size-4" />
          </Button>
          <Button variant="ghost2" size="icon" onClick={onRemove} title="Delete server">
            <Trash2 className="tw-size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
