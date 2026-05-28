import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENV_VAR_NAME_RE } from "@/settings/model";
import { debounce } from "@/utils/debounce";
import { Plus, Trash2 } from "lucide-react";
import React from "react";

interface Props {
  value: Record<string, string> | undefined;
  onChange: (next: Record<string, string> | undefined) => void;
  /** Backend label woven into the description, e.g. "Claude" or "opencode". */
  backendDisplayName: string;
  /**
   * Two example var names shown in the description and as the first row's
   * placeholder. Cosmetic only — no validation is performed against this list.
   */
  hintExamples: [string, string];
}

interface Row {
  id: string;
  name: string;
  value: string;
}

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `row-${rowIdCounter}`;
}

function recordToRows(record: Record<string, string> | undefined): Row[] {
  if (!record) return [];
  return Object.entries(record).map(([name, value]) => ({
    id: nextRowId(),
    name,
    value,
  }));
}

function rowsToRecord(rows: Row[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    // Skip names that fail validation so malformed keys never reach
    // backend spawn paths, which read `envOverrides` from settings
    // directly without re-sanitizing.
    if (!ENV_VAR_NAME_RE.test(name)) continue;
    out[name] = row.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const COMMIT_DEBOUNCE_MS = 400;

/**
 * Per-agent environment variable editor. Renders a labeled list of
 * `name` / `value` rows plus an "Add variable" button. Values are stored
 * verbatim — `~` is not expanded and whitespace is preserved.
 *
 * Persistence is debounced (`COMMIT_DEBOUNCE_MS`) to avoid rewriting
 * settings on every keystroke; the pending commit is flushed on unmount so
 * the last edit always lands. The parent's `value` is consulted only at
 * mount — external reloads while the editor is open are uncommon.
 *
 * Validation is permissive in the input: invalid names surface an inline
 * warning but don't block typing. `rowsToRecord` then drops malformed
 * rows before commit, so the persisted record (and the env passed to
 * backend subprocesses) only ever contains valid POSIX identifiers.
 */
export const EnvOverridesSetting: React.FC<Props> = ({
  value,
  onChange,
  backendDisplayName,
  hintExamples,
}) => {
  const [rows, setRows] = React.useState<Row[]>(() => recordToRows(value));

  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const debouncedCommit = React.useMemo(
    () =>
      debounce((next: Row[]): void => {
        onChangeRef.current(rowsToRecord(next));
      }, COMMIT_DEBOUNCE_MS),
    []
  );

  React.useEffect(() => () => debouncedCommit.flush(), [debouncedCommit]);

  const commit = (next: Row[]): void => {
    setRows(next);
    debouncedCommit(next);
  };

  const updateRow = (id: string, patch: Partial<Pick<Row, "name" | "value">>): void => {
    commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string): void => {
    commit(rows.filter((r) => r.id !== id));
  };

  const addRow = (): void => {
    // Empty rows are visible locally but excluded from the committed record
    // by `rowsToRecord` — so this purposely doesn't call `commit`.
    setRows((prev) => [...prev, { id: nextRowId(), name: "", value: "" }]);
  };

  const [hintA, hintB] = hintExamples;

  return (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-py-4">
      <div className="tw-flex tw-flex-col tw-gap-1">
        <div className="tw-text-sm tw-font-medium tw-leading-none">Environment variables</div>
        <div className="tw-text-xs tw-text-muted">
          Set values for {backendDisplayName}, like <code>{hintA}</code> or <code>{hintB}</code>.
        </div>
      </div>
      <div className="tw-flex tw-w-full tw-flex-col tw-gap-2">
        {rows.map((row) => {
          const trimmed = row.name.trim();
          const nameInvalid = trimmed.length > 0 && !ENV_VAR_NAME_RE.test(trimmed);
          return (
            <div key={row.id} className="tw-flex tw-flex-col tw-gap-1">
              <div className="tw-flex tw-items-start tw-gap-2">
                <Input
                  type="text"
                  placeholder={hintA}
                  value={row.name}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="tw-flex-1 tw-font-mono"
                  aria-invalid={nameInvalid || undefined}
                  onChange={(e) => updateRow(row.id, { name: e.target.value })}
                />
                <Input
                  type="text"
                  placeholder="value"
                  value={row.value}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="tw-flex-[2] tw-font-mono"
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove variable"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 className="tw-size-icon-s" />
                </Button>
              </div>
              {nameInvalid && (
                <div className="tw-text-xs tw-text-error">
                  Name must start with a letter or underscore and contain only letters, digits, and
                  underscores.
                </div>
              )}
            </div>
          );
        })}
        <div className="tw-flex tw-justify-end">
          <Button variant="secondary" size="default" onClick={addRow}>
            <Plus className="tw-size-icon-xs" />
            Add variable
          </Button>
        </div>
      </div>
    </div>
  );
};
