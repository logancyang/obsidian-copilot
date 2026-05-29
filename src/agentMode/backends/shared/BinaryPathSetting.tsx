import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logError } from "@/logger";
import { detectionSearchDirs } from "@/utils/binaryPath";
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
  /**
   * Custom detector. Used when the backend has a richer install lookup than
   * a generic `which`/`where` PATH search — e.g. Claude knows about
   * `~/.local/bin/claude`, Volta, asdf, NVM. Falls back to
   * {@link detectBinary} when omitted.
   */
  detect?: () => Promise<string | null>;
  /**
   * Directories the detector searched, listed under the "not found" hint so
   * users can self-diagnose. Defaults to {@link detectionSearchDirs} (what the
   * generic `which`/`where` path actually searches) when omitted.
   */
  searchedDirs?: () => string[];
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
  detect,
  searchedDirs,
}) => {
  const [pathInput, setPathInput] = React.useState(initialPath);
  const [error, setError] = React.useState<string | null>(null);
  const [searched, setSearched] = React.useState<string[]>([]);
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
    setSearched([]);
  }, [pathInput, onSave]);

  const autoDetect = React.useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSearched([]);
    try {
      const found = detect ? await detect() : await detectBinary(binaryName);
      if (!found) {
        setError(
          notFoundHint ??
            `${binaryName} not found on PATH. Install it or paste a custom path manually.`
        );
        // Without a custom detector we know exactly which dirs were searched.
        const dirs = searchedDirs ?? (detect ? undefined : detectionSearchDirs);
        setSearched(dirs?.() ?? []);
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
  }, [binaryName, busy, notFoundHint, onSave, persistOnAutoDetect, detect, searchedDirs]);

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
        <Button variant="default" size="default" onClick={apply} disabled={busy}>
          Apply
        </Button>
      </div>
      {error && (
        <div className="tw-flex tw-flex-col tw-gap-1 tw-text-sm tw-text-error">
          <span>{error}</span>
          {searched.length > 0 && (
            <div className="tw-text-muted">
              <span>Searched:</span>
              <ul className="tw-my-0 tw-pl-4">
                {searched.map((dir) => (
                  <li key={dir}>{dir}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
