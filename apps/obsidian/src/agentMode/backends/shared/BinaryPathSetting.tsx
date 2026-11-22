import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logError } from "@/logger";
import { detectionSearchDirs } from "@/utils/binaryPath";
import { detectBinary } from "@/utils/detectBinary";
import { Notice } from "obsidian";
import React from "react";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface Props {
  binaryName: string;
  placeholder: string;
  initialPath: string;
  hasPersistedPath?: boolean;
  notFoundHint?: string;
  onSave: (path: string) => Promise<string | null>;
  onClear?: () => void | Promise<void>;
  persistOnAutoDetect?: boolean;
  detect?: () => Promise<string | null>;
  searchedDirs?: () => string[];
}

export const BinaryPathSetting: React.FC<Props> = ({
  binaryName,
  placeholder,
  initialPath,
  hasPersistedPath = initialPath.trim() !== "",
  notFoundHint,
  onSave,
  onClear,
  persistOnAutoDetect = false,
  detect,
  searchedDirs,
}) => {
  const [pathInput, setPathInput] = React.useState(initialPath);
  const [error, setError] = React.useState<string | null>(null);
  const [searched, setSearched] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    setSearched([]);
    try {
      const found = detect ? await detect() : await detectBinary(binaryName);
      // Leaving this control abandons detection; a late result must not overwrite
      // a managed installation selected in the meantime.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/398
      if (!mounted.current) return;
      if (!found) {
        setError(
          notFoundHint ??
            `${binaryName} not found on PATH. Install it or paste a custom path manually.`
        );
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

  const draftMatchesInitial = pathInput.trim() === initialPath.trim();
  const showClear = Boolean(onClear) && hasPersistedPath && draftMatchesInitial;
  const showApply = !draftMatchesInitial || initialPath.trim() === "";

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
        <Button
          variant="secondary"
          size="default"
          onClick={safeAsyncHandler(autoDetect)}
          disabled={busy}
        >
          Auto-detect
        </Button>
        {showClear ? (
          <Button
            variant="destructive"
            size="default"
            onClick={safeAsyncHandler(clear)}
            disabled={busy}
          >
            Clear
          </Button>
        ) : showApply ? (
          <Button
            variant="default"
            size="default"
            onClick={safeAsyncHandler(apply)}
            disabled={busy}
          >
            Apply
          </Button>
        ) : null}
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
