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
  /** When true, a successful auto-detect immediately invokes `onSave`. */
  persistOnAutoDetect?: boolean;
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
  persistOnAutoDetect = false,
}) => {
  const [pathInput, setPathInput] = React.useState(initialPath);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
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

  const autoDetect = React.useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = await detectBinary(binaryName);
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
  }, [binaryName, busy, notFoundHint, onSave, persistOnAutoDetect]);

  return (
    <div className="tw-flex tw-w-full tw-flex-col tw-gap-2 sm:tw-w-[360px]">
      <div className="tw-flex tw-items-center tw-gap-2">
        <Input
          type="text"
          placeholder={placeholder}
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={autoDetect} disabled={busy}>
          Auto-detect
        </Button>
      </div>
      <div className="tw-flex tw-justify-end">
        <Button variant="default" onClick={apply} disabled={busy}>
          Apply
        </Button>
      </div>
      {error && <div className="tw-text-xs tw-text-error">{error}</div>}
    </div>
  );
};
