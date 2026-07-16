import { type StoredMcpServer } from "@/agentMode/session/mcpResolver";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ObsidianNativeSelect, type SelectOption } from "@/components/ui/obsidian-native-select";
import { Textarea } from "@/components/ui/textarea";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { Plus, Trash2 } from "lucide-react";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";

const TRANSPORT_OPTIONS: SelectOption[] = [
  { label: "stdio (local command)", value: "stdio" },
  { label: "http", value: "http" },
  { label: "sse", value: "sse" },
];

interface KeyValueRow {
  name: string;
  value: string;
}

export interface McpServerFormProps {
  /** Initial draft — a fresh blank server for "Add" or an existing one for "Edit". */
  initial: StoredMcpServer;
  onCancel: () => void;
  onSubmit: (draft: StoredMcpServer) => void;
}

/**
 * Pure draft-editing form for an MCP server, rendered inside
 * {@link McpServerModal}. Holds a local draft and only calls `onSubmit` when
 * the user clicks Save; Cancel/ESC discard the draft without persisting.
 *
 * Exported separately from the `Modal` wrapper so it can be unit-tested in
 * jsdom without spinning up Obsidian's native modal chrome.
 */
export const McpServerForm: React.FC<McpServerFormProps> = ({ initial, onCancel, onSubmit }) => {
  const [draft, setDraft] = React.useState<StoredMcpServer>(initial);
  // Reason: textarea is edited as raw multi-line text; trimming/dropping blank
  // lines on every keystroke would fight the cursor. Normalize only on submit.
  const [argsText, setArgsText] = React.useState(() => (initial.args ?? []).join("\n"));

  const patch = (next: Partial<StoredMcpServer>) => setDraft((cur) => ({ ...cur, ...next }));

  const isStdio = draft.transport === "stdio";
  const isValid =
    draft.name.trim().length > 0 &&
    (isStdio ? (draft.command ?? "").trim().length > 0 : (draft.url ?? "").trim().length > 0);

  const handleSave = () => {
    if (!isValid) return;
    const args = argsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    onSubmit({ ...draft, args });
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <Field label="Server name">
        <Input
          placeholder="Server name (e.g. filesystem)"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>

      <Field label="Transport">
        <ObsidianNativeSelect
          options={TRANSPORT_OPTIONS}
          value={draft.transport}
          onChange={(e) => patch({ transport: e.target.value as StoredMcpServer["transport"] })}
        />
      </Field>

      {isStdio ? (
        <>
          <Field label="Command">
            <Input
              placeholder="npx"
              value={draft.command ?? ""}
              onChange={(e) => patch({ command: e.target.value })}
            />
          </Field>
          <Field label="Arguments" hint="One per line">
            <Textarea
              rows={4}
              placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
            />
          </Field>
          <Field label="Environment">
            <KeyValueEditor
              rows={draft.env ?? []}
              onChange={(env) => patch({ env })}
              keyPlaceholder="VAR_NAME"
              valuePlaceholder="value"
              addLabel="Add variable"
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="URL">
            <Input
              placeholder="https://example.com/mcp"
              value={draft.url ?? ""}
              onChange={(e) => patch({ url: e.target.value })}
            />
          </Field>
          <Field label="Headers">
            <KeyValueEditor
              rows={draft.headers ?? []}
              onChange={(headers) => patch({ headers })}
              keyPlaceholder="Authorization"
              valuePlaceholder="Bearer …"
              addLabel="Add header"
            />
          </Field>
        </>
      )}

      <div className="tw-flex tw-justify-end tw-gap-2 tw-pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" disabled={!isValid} onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
};

/** Stacked label-above-input field used throughout the modal form. */
const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div className="tw-flex tw-flex-col tw-gap-1.5">
    <div className="tw-flex tw-items-baseline tw-gap-2">
      <span className="tw-text-sm tw-font-medium tw-text-normal">{label}</span>
      {hint && <span className="tw-text-xs tw-text-muted">{hint}</span>}
    </div>
    {children}
  </div>
);

/** Editable list of `{name, value}` rows for env vars / HTTP headers. */
const KeyValueEditor: React.FC<{
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}> = ({ rows, onChange, keyPlaceholder, valuePlaceholder, addLabel }) => {
  const updateRow = (index: number, next: Partial<KeyValueRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));
  const removeRow = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const addRow = () => onChange([...rows, { name: "", value: "" }]);

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {rows.map((row, index) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key -- rows lack stable ids; name may be empty/duplicate while editing
        <div key={`row-${index}`} className="tw-flex tw-items-center tw-gap-2">
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
      <Button variant="secondary" size="sm" className="tw-self-start" onClick={addRow}>
        <Plus className="tw-size-4" />
        {addLabel}
      </Button>
    </div>
  );
};

/**
 * Native Obsidian modal hosting {@link McpServerForm} for adding or editing
 * an MCP server. Built on Obsidian's `Modal` (not the Radix `Dialog`) for
 * popout-window safety, native header chrome, and ESC handling — see
 * `src/agentMode/CLAUDE.md` (Modals section). Closing without Save (Cancel,
 * ESC, header X) never invokes `onSubmit`, so no draft is persisted.
 */
export class McpServerModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly initial: StoredMcpServer,
    private readonly mode: "add" | "edit",
    private readonly onSubmit: (draft: StoredMcpServer) => void
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle(mode === "add" ? "Add MCP server" : "Edit MCP server");
  }

  onOpen() {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <McpServerForm
        initial={this.initial}
        onCancel={() => this.close()}
        onSubmit={(draft) => {
          this.onSubmit(draft);
          this.close();
        }}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
  }
}
