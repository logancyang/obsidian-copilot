import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logError } from "@/logger";
import { detectBinary } from "@/utils/detectBinary";
import { Notice } from "obsidian";
import React from "react";

interface Props {
  binaryName: string;
  placeholder: string;
  initialPath: string;
  /** Optional hint surfaced when auto-detect finds nothing. */
  notFoundHint?: string;
  /** Validate & persist on Apply. Returns null on success, error message on failure. */
  onSave: (path: string) => Promise<string | null>;
  /**
   * Clear the persisted custom path. When provided, the Apply button becomes a
   * Clear button once a usable path is applied (see `showClear` below).
   */
  onClear?: () => void | Promise<void>;
  /** When true, a successful auto-detect immediately invokes `onSave`. */
  persistOnAutoDetect?: boolean;
  /**
   * Custom detector. Used when the backend has a richer install lookup than
   * a generic `which`/`where` PATH search — e.g. Claude knows about
   * `~/.local/bin/claude`, Volta, asdf, NVM. Falls back to
   * {@link detectBinary} when omitted.
   */
  detect?: () => Promise<string | null>;
}

/**
 * Shared "binary path" setting row used by every Agent Mode backend that
 * spawns a local executable. Owns the Input + Auto-detect + Apply UX with
 * busy/error state. Callers parameterize the binary name, placeholder, and
 * persistence callback; the surrounding `<SettingItem>` (title/description)
 * stays in the backend-specific panel.
 */
export const BinaryPathSetting: React.FC<Props> = ({
  binaryName,
  placeholder,
  initialPath,
  notFoundHint,
  onSave,
  onClear,
  persistOnAutoDetect = false,
  detect,
}) => {
  const [pathInput, setPathInput] = React.useState(initialPath);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- sync the editable draft when the persisted path changes underneath us (e.g. auto-detect from another panel); a key-prop remount would drop in-flight edits
    setPathInput(initialPath);
  }, [initialPath]);

  const apply = React.useCallback(async (): Promise<void> => {
    const trimmed = pathInput.trim();
    if (!trimmed) {
      setError("Path is required.");
      return;
    }
    const err = await onSave(trimmed);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
  }, [pathInput, onSave]);

  const clear = React.useCallback(async (): Promise<void> => {
    if (busy || !onClear) return;
    setBusy(true);
    setError(null);
    try {
      await onClear();
    } finally {
      setBusy(false);
    }
  }, [busy, onClear]);

  const autoDetect = React.useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = detect ? await detect() : await detectBinary(binaryName);
      if (!found) {
        setError(
          notFoundHint ??
            `${binaryName} not found on PATH. Install it or paste a custom path manually.`
        );
        return;
      }
      setPathInput(found);
      if (persistOnAutoDetect) {
        const err = await onSave(found);
        if (err) {
          setError(err);
          return;
        }
      }
      new Notice(`Found ${binaryName} at ${found}`);
    } catch (e) {
      logError(`[AgentMode] auto-detect ${binaryName} failed`, e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [binaryName, busy, notFoundHint, onSave, persistOnAutoDetect, detect]);

  // A usable custom path is applied (`initialPath` is the persisted value, validated
  // on save/auto-detect) and the draft matches it — so re-applying would be a no-op.
  // An in-flight edit flips the button back to Apply so the new value can be saved.
  const showClear =
    Boolean(onClear) && initialPath.trim() !== "" && pathInput.trim() === initialPath.trim();

  return (
    <div className="tw-flex tw-w-full tw-flex-col tw-gap-2">
      <div className="tw-flex tw-items-center tw-gap-2">
        <Input
          type="text"
          placeholder={placeholder}
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          className="tw-flex-1"
        />
        <Button variant="secondary" size="default" onClick={autoDetect} disabled={busy}>
          Auto-detect
        </Button>
        {showClear ? (
          <Button variant="destructive" size="default" onClick={clear} disabled={busy}>
            Clear
          </Button>
        ) : (
          <Button variant="default" size="default" onClick={apply} disabled={busy}>
            Apply
          </Button>
        )}
      </div>
      {error && <div className="tw-text-sm tw-text-error">{error}</div>}
    </div>
  );
};
