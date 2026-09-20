import { ReactModal } from "@/components/modals/ReactModal";
import { cn } from "@/lib/utils";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import { getMiyoFolderName, getVaultRelativeMiyoPath } from "@/miyo/miyoUtils";
import { checkIsPlusUser, isPlusEnabled } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { getTagsFromNote } from "@/utils";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { useVaultSearch } from "@/vaultSearch/useVaultSearch";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";
import { createJevSearchBooster, type JevSearchBooster } from "@/vaultSearch/boost/jevBooster";
import { FileSystemAdapter, Notice, Platform, TFile, prepareFuzzySearch, type App } from "obsidian";
import React, { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";

export interface FileTypeOption {
  extension: string;
  count: number;
  checked: boolean;
}

export interface VaultSearchModalContentProps {
  query: string;
  onQueryChange: (query: string) => void;
  fileTypes: FileTypeOption[];
  onTypeChange: (extension: string, checked: boolean) => void;
  results: SearchCandidate[];
  searching: boolean;
  miyoUnavailable: boolean;
  aiBoostEnabled: boolean;
  aiBoostLicensed: boolean;
  aiBoosting: boolean;
  onAiBoostChange: (enabled: boolean) => void;
  onAiBoostNow: () => void;
  onOpen: (candidate: SearchCandidate, newTab: boolean) => void;
  onClose: () => void;
  isMobile: boolean;
  canOpenInObsidian: (extension: string) => boolean;
}

export function buildFileTypeOptions(
  files: SearchFile[],
  excludedTypes: readonly string[]
): FileTypeOption[] {
  const excluded = new Set(excludedTypes);
  const counts = new Map<string, number>();
  for (const file of files) {
    const extension = file.extension.toLowerCase();
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([extension, count]) => ({ extension, count, checked: !excluded.has(extension) }));
}

/** Open a result in Obsidian when it has a registered view, otherwise use the desktop OS. */
export async function openVaultSearchResult(
  app: App,
  candidate: SearchCandidate,
  newTab: boolean
): Promise<boolean> {
  try {
    const file = app.vault.getAbstractFileByPath(candidate.path);
    if (file instanceof TFile) {
      if (canObsidianRenderFile(app, candidate.extension)) {
        await app.workspace.openLinkText(file.path, "", newTab);
        return true;
      }
      const adapter = app.vault.adapter;
      if (!Platform.isMobile && adapter instanceof FileSystemAdapter) {
        await openWithSystemDefault(adapter.getFullPath(file.path));
        return true;
      }
    }
  } catch {
    // Opening failures follow the same user-facing path as stale and unavailable results.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/515
  }
  new Notice("Could not open this file.");
  return false;
}

export function canObsidianRenderFile(app: App, extension: string): boolean {
  const registry = (
    app as App & {
      viewRegistry?: { getTypeByExtension?: (extension: string) => string | null | undefined };
    }
  ).viewRegistry;
  if (registry?.getTypeByExtension) {
    return Boolean(registry.getTypeByExtension(extension));
  }
  return FALLBACK_RENDERABLE_EXTENSIONS.has(extension.toLowerCase());
}

const FALLBACK_RENDERABLE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "canvas",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "svg",
  "webp",
  "avif",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "webm",
  "mp4",
  "mov",
  "mkv",
]);

export function VaultSearchModalContent({
  query,
  onQueryChange,
  fileTypes,
  onTypeChange,
  results,
  searching,
  miyoUnavailable,
  aiBoostEnabled,
  aiBoostLicensed,
  aiBoosting,
  onAiBoostChange,
  onAiBoostNow,
  onOpen,
  onClose,
  isMobile,
  canOpenInObsidian,
}: VaultSearchModalContentProps): ReactElement {
  const [preferredPath, setPreferredPath] = useState<string | null>(results[0]?.path ?? null);
  const selectedPath = results.some(({ path }) => path === preferredPath)
    ? preferredPath
    : (results[0]?.path ?? null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (
      event.key === "Enter" &&
      aiBoostEnabled &&
      query.trim().length >= 3 &&
      !results.some(({ boostScore }) => boostScore !== undefined)
    ) {
      event.preventDefault();
      if (!aiBoosting) onAiBoostNow();
      return;
    }
    if (results.length === 0) return;
    const selectedIndex = Math.max(
      0,
      results.findIndex(({ path }) => path === selectedPath)
    );
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (selectedIndex + delta + results.length) % results.length;
      setPreferredPath(results[nextIndex].path);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(results[selectedIndex], event.metaKey || event.ctrlKey);
    }
  };

  return (
    <div className="tw-flex tw-max-h-[70vh] tw-min-h-96 tw-w-[min(760px,85vw)] tw-flex-col tw-gap-3">
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search every file in your vault"
        aria-label="Search vault files"
        className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-3 tw-py-2 tw-text-normal focus:tw-border-border-focus focus:tw-outline-none"
      />
      <div className="tw-flex tw-flex-wrap tw-gap-x-3 tw-gap-y-1" aria-label="File types">
        {fileTypes.map(({ extension, count, checked }) => (
          <label
            key={extension}
            className="tw-flex tw-items-center tw-gap-1 tw-text-small tw-text-muted"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => onTypeChange(extension, event.target.checked)}
            />
            <span>{extension || "no extension"}</span>
            <span>{count.toLocaleString()}</span>
          </label>
        ))}
      </div>
      <div className="tw-flex tw-items-center tw-gap-2 tw-text-small tw-text-muted">
        <label className="tw-flex tw-items-center tw-gap-1">
          <input
            type="checkbox"
            aria-label="AI boost"
            checked={aiBoostEnabled}
            disabled={!aiBoostLicensed}
            onChange={(event) => onAiBoostChange(event.target.checked)}
          />
          <span>AI boost</span>
        </label>
        <span
          aria-label={aiBoostLicensed ? "Re-ranks results with AI" : "License required"}
          title={aiBoostLicensed ? "Re-ranks results with AI" : "License required"}
        >
          !
        </span>
        {!aiBoostLicensed && <span>License required</span>}
      </div>
      {miyoUnavailable && (
        <div className="tw-text-small tw-text-muted">Enable Miyo for content search</div>
      )}
      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto" role="listbox">
        {results.map((candidate) => {
          const selected = candidate.path === selectedPath;
          const opensExternally = !canOpenInObsidian(candidate.extension);
          return (
            <button
              key={candidate.path}
              type="button"
              role="option"
              aria-selected={selected}
              onMouseEnter={() => setPreferredPath(candidate.path)}
              onClick={() => onOpen(candidate, false)}
              className={cn(
                "tw-m-0 tw-flex tw-h-auto tw-w-full tw-flex-col tw-gap-1 tw-rounded-md tw-border-0 tw-bg-transparent tw-p-2 tw-text-left tw-text-normal hover:tw-bg-secondary",
                selected && "tw-bg-secondary"
              )}
            >
              <span className="tw-flex tw-w-full tw-items-center tw-gap-2">
                <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-font-medium">
                  {candidate.title}
                </span>
                <span className="tw-rounded tw-bg-modifier-hover tw-px-1.5 tw-py-0.5 tw-text-smallest tw-uppercase tw-text-muted">
                  {candidate.extension || "file"}
                </span>
                {candidate.boostScore !== undefined ? (
                  <span className="tw-text-small tw-tabular-nums tw-text-muted">
                    {Math.round(candidate.boostScore * 100)}%
                  </span>
                ) : candidate.score !== null ? (
                  <span className="tw-text-small tw-tabular-nums tw-text-muted">
                    {candidate.score.toFixed(2)}
                  </span>
                ) : null}
              </span>
              <span className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-text-small tw-text-muted">
                <span className="tw-min-w-0 tw-flex-1 tw-truncate">{candidate.folder || "/"}</span>
                {candidate.mtime > 0 && (
                  <span>{new Date(candidate.mtime).toLocaleDateString()}</span>
                )}
              </span>
              <span className="tw-w-full tw-truncate tw-text-small tw-text-muted">
                {candidate.snippet}
              </span>
              {opensExternally && (
                <span className="tw-text-smallest tw-text-muted">
                  {isMobile ? "Unavailable on mobile" : "Opens in the default app"}
                </span>
              )}
            </button>
          );
        })}
        {results.length === 0 && (
          <div className="tw-py-10 tw-text-center tw-text-small tw-text-muted">
            {searching
              ? "Searching…"
              : query.trim()
                ? "No matching files"
                : "Recently opened files will appear here"}
          </div>
        )}
      </div>
    </div>
  );
}

function VaultSearchModalBody({
  app,
  close,
  timerWindow,
}: {
  app: App;
  close: () => void;
  timerWindow: Window;
}) {
  const settings = useSettingsValue();
  const [aiBoostLicensed, setAiBoostLicensed] = useState(() => isPlusEnabled());
  const client = useMemo(() => new MiyoClient(), []);
  const files = useMemo<SearchFile[]>(
    () =>
      app.vault.getFiles().map((file) => ({
        path: file.path,
        name: file.name,
        basename: file.basename,
        extension: file.extension.toLowerCase(),
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        size: file.stat.size,
        tags: getTagsFromNote(app, file, false),
      })),
    [app]
  );
  const fileTypes = useMemo(
    () => buildFileTypeOptions(files, settings.vaultSearchExcludedFileTypes),
    [files, settings.vaultSearchExcludedFileTypes]
  );
  const selectedTypes = useMemo(
    () => new Set(fileTypes.filter(({ checked }) => checked).map(({ extension }) => extension)),
    [fileTypes]
  );
  useEffect(() => {
    let active = true;
    void checkIsPlusUser(app, "vault_search")
      .then((licensed) => {
        if (active) setAiBoostLicensed(licensed);
      })
      .catch(() => {
        if (active) setAiBoostLicensed(false);
      });
    return () => {
      active = false;
    };
  }, [app]);
  const booster = useMemo<JevSearchBooster | undefined>(() => {
    if (!aiBoostLicensed || !settings.vaultSearchAiBoostEnabled) return undefined;
    return createJevSearchBooster({
      files,
      selectedTypes,
      prepareSearch: prepareFuzzySearch,
      vaultName: app.vault.getName(),
      timerWindow,
    });
  }, [aiBoostLicensed, app, files, selectedTypes, settings.vaultSearchAiBoostEnabled, timerWindow]);
  const searchMiyo = useCallback(
    async (query: string, limit: number, paths?: string[]) => {
      const baseUrl = await client.resolveBaseUrl(getMiyoCustomUrl(settings) || undefined);
      const response = await client.search(
        baseUrl,
        getMiyoFolderName(app),
        query,
        limit,
        undefined,
        paths
      );
      return response.results;
    },
    [app, client, settings]
  );
  const search = useVaultSearch({
    files,
    recentPaths: app.workspace.getLastOpenFiles(),
    selectedTypes,
    allTypes: fileTypes.map(({ extension }) => extension),
    miyoEnabled: shouldUseMiyo(settings),
    searchMiyo,
    prepareSearch: prepareFuzzySearch,
    mapMiyoPath: (path) => getVaultRelativeMiyoPath(app, path),
    booster,
    timerWindow,
  });
  const onTypeChange = (extension: string, checked: boolean) => {
    const excluded = new Set(settings.vaultSearchExcludedFileTypes);
    if (checked) excluded.delete(extension);
    else excluded.add(extension);
    updateSetting("vaultSearchExcludedFileTypes", [...excluded].sort());
  };
  const onOpen = (candidate: SearchCandidate, newTab: boolean) => {
    booster?.logOpened(candidate.path);
    void openVaultSearchResult(app, candidate, newTab).then((opened) => {
      if (opened) close();
    });
  };

  return (
    <VaultSearchModalContent
      query={search.query}
      onQueryChange={search.setQuery}
      fileTypes={fileTypes}
      onTypeChange={onTypeChange}
      results={search.results}
      searching={search.searching}
      miyoUnavailable={search.miyoUnavailable}
      aiBoostEnabled={aiBoostLicensed && settings.vaultSearchAiBoostEnabled}
      aiBoostLicensed={aiBoostLicensed}
      aiBoosting={search.boosting}
      onAiBoostChange={(enabled) => updateSetting("vaultSearchAiBoostEnabled", enabled)}
      onAiBoostNow={search.boostNow}
      onOpen={onOpen}
      onClose={close}
      isMobile={Platform.isMobile}
      canOpenInObsidian={(extension) => canObsidianRenderFile(app, extension)}
    />
  );
}

/** Obsidian modal that owns the whole-vault Copilot search surface. */
export class VaultSearchModal extends ReactModal {
  constructor(app: App) {
    super(app, "Copilot search", "copilot-vault-search-modal");
  }

  protected renderContent(close: () => void): ReactElement {
    return <VaultSearchModalBody app={this.app} close={close} timerWindow={this.contentEl.win} />;
  }
}
