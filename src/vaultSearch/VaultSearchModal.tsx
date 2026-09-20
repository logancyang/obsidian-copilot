import { RelevanceMeter } from "@/components/chat-components/ui/RelevanceMeter";
import { useRelevantNoteRowTransitions } from "@/components/chat-components/ui/useRelevantNoteRowTransitions";
import { ReactModal } from "@/components/modals/ReactModal";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import { getMiyoFolderName, getVaultRelativeMiyoPath } from "@/miyo/miyoUtils";
import { checkIsPlusUser, isPlusEnabled } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { getTagsFromNote } from "@/utils";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { prepareFilenameSearch } from "@/vaultSearch/candidates";
import { useVaultSearch } from "@/vaultSearch/useVaultSearch";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";
import { createJevSearchBooster, type JevSearchBooster } from "@/vaultSearch/boost/jevBooster";
import { ExternalLink } from "lucide-react";
import { FileSystemAdapter, Notice, Platform, TFile, type App } from "obsidian";
import React, { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";

export interface FileTypeOption {
  id: string;
  label: string;
  extensions: string[];
  count: number;
  checked: boolean;
}

// Miyo's default folder contract; uncommon/custom extensions stay reachable through Other.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/515
const DEFAULT_MIYO_EXTENSIONS = new Set(["md", "txt", "pdf", "epub", "docx"]);
const MAX_VISIBLE_FILE_TYPE_OPTIONS = 6;

export interface VaultSearchModalContentProps {
  query: string;
  onQueryChange: (query: string) => void;
  fileTypes: FileTypeOption[];
  onTypeChange: (extensions: readonly string[], checked: boolean) => void;
  results: SearchCandidate[];
  searching: boolean;
  miyoUnavailable: boolean;
  aiBoostEnabled: boolean;
  aiBoostLicensed: boolean;
  aiBoosting: boolean;
  aiBoostAttemptCompleted: boolean;
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
  const common = [...counts]
    .filter(([extension]) => DEFAULT_MIYO_EXTENSIONS.has(extension))
    .sort(([leftExtension, leftCount], [rightExtension, rightCount]) =>
      rightCount === leftCount
        ? leftExtension.localeCompare(rightExtension)
        : rightCount - leftCount
    )
    .slice(0, MAX_VISIBLE_FILE_TYPE_OPTIONS - 1);
  const visible = new Set(common.map(([extension]) => extension));
  const options: FileTypeOption[] = common.map(([extension, count]) => ({
    id: extension,
    label: extension,
    extensions: [extension],
    count,
    checked: !excluded.has(extension),
  }));
  const other = [...counts]
    .filter(([extension]) => !visible.has(extension))
    .sort(([left], [right]) => left.localeCompare(right));
  if (other.length > 0) {
    const extensions = other.map(([extension]) => extension);
    options.push({
      id: "other",
      label: "Other",
      extensions,
      count: other.reduce((total, [, count]) => total + count, 0),
      checked: extensions.every((extension) => !excluded.has(extension)),
    });
  }
  return options;
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
  aiBoostAttemptCompleted,
  onAiBoostChange,
  onAiBoostNow,
  onOpen,
  onClose,
  isMobile,
  canOpenInObsidian,
}: VaultSearchModalContentProps): ReactElement {
  const animated = !useReducedMotion();
  const { rows, registerRow } = useRelevantNoteRowTransitions(
    results,
    query.trim(),
    animated,
    (candidate) => candidate.path
  );
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
      !aiBoostAttemptCompleted &&
      !results.some(({ boostScore }) => boostScore !== undefined)
    ) {
      // A completed failure must not trap keyboard users in retrying optional enrichment.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/516
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
  const hasStrongMatch = results.some(({ boostScore }) => (boostScore ?? -1) >= 0.5);
  // The calibrated boundary should read as confidence, not just a reordered list.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/516
  const showBoostOutcome = aiBoostEnabled && aiBoostAttemptCompleted;
  let renderedLessLikely = false;

  return (
    <div className="tw-flex tw-max-h-[70vh] tw-min-h-96 tw-w-[min(760px,85vw)] tw-flex-col tw-gap-3 tw-px-4 tw-pb-4">
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
      <div
        className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-overflow-x-auto"
        aria-label="File types"
      >
        {fileTypes.map(({ id, label, extensions, count, checked }) => (
          <button
            key={id}
            type="button"
            aria-pressed={checked}
            onClick={() => onTypeChange(extensions, !checked)}
            className={cn(
              "tw-m-0 tw-flex tw-h-6 tw-shrink-0 tw-items-center tw-gap-1 tw-whitespace-nowrap tw-rounded-full tw-border tw-border-solid tw-border-border tw-px-2 tw-py-0 tw-text-xs tw-shadow-none",
              checked
                ? "tw-bg-modifier-hover tw-text-normal"
                : "tw-bg-transparent tw-text-faint hover:tw-bg-modifier-hover"
            )}
          >
            <span>{label}</span>
            <span className="tw-tabular-nums tw-text-faint">{count.toLocaleString()}</span>
          </button>
        ))}
      </div>
      <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
        <SettingSwitch
          aria-label="AI boost"
          checked={aiBoostEnabled}
          disabled={!aiBoostLicensed}
          onCheckedChange={onAiBoostChange}
        />
        <span>AI boost</span>
        {!aiBoostLicensed && <span className="tw-text-faint">License required</span>}
      </div>
      {miyoUnavailable && (
        <div className="tw-text-small tw-text-muted">Enable Miyo for content search</div>
      )}
      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto" role="listbox">
        {showBoostOutcome && !hasStrongMatch && (
          <div className="tw-px-2.5 tw-py-1.5 tw-text-xs tw-text-muted">No strong match</div>
        )}
        {rows.map(({ note: candidate, entering, exiting }) => {
          const selected = candidate.path === selectedPath;
          const opensExternally = !canOpenInObsidian(candidate.extension);
          const displayScore = candidate.boostScore ?? candidate.score;
          const lessLikely = hasStrongMatch && (candidate.boostScore ?? -1) < 0.5;
          const divider = lessLikely && !renderedLessLikely;
          if (divider) renderedLessLikely = true;
          return (
            <React.Fragment key={candidate.path}>
              {divider && (
                <div className="tw-px-2.5 tw-py-1.5 tw-text-xs tw-text-faint">Less likely</div>
              )}
              <button
                ref={registerRow(candidate.path)}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setPreferredPath(candidate.path)}
                onClick={() => onOpen(candidate, false)}
                className={cn(
                  "tw-m-0 tw-flex tw-h-auto tw-w-full tw-flex-col tw-gap-1 tw-rounded-md tw-border-0 tw-bg-transparent tw-px-2.5 tw-py-1.5 tw-text-left tw-text-normal tw-shadow-none tw-transition-colors hover:tw-bg-modifier-hover",
                  selected && "tw-bg-modifier-hover",
                  entering && "tw-duration-200 tw-animate-in tw-fade-in-0 tw-slide-in-from-top-1",
                  exiting && "tw-pointer-events-none tw-opacity-0",
                  exiting && animated && "tw-transition-opacity tw-duration-200"
                )}
              >
                <span className="tw-flex tw-w-full tw-items-center tw-gap-2">
                  <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-medium">
                    {candidate.title}
                  </span>
                  <span className="tw-rounded tw-bg-modifier-hover tw-px-1.5 tw-py-0.5 tw-text-smallest tw-uppercase tw-text-muted">
                    {candidate.extension || "file"}
                  </span>
                  {displayScore !== null && (
                    <span
                      title={
                        candidate.boostScore === undefined ? "Similarity" : "AI boost relevance"
                      }
                      className="tw-text-xs tw-font-medium tw-tabular-nums tw-text-muted"
                    >
                      {Math.round(displayScore * 100)}%
                    </span>
                  )}
                  {opensExternally && (
                    <span
                      title={isMobile ? "Unavailable on mobile" : "Opens in the default app"}
                      aria-label={isMobile ? "Unavailable on mobile" : "Opens in the default app"}
                      className="tw-flex tw-shrink-0 tw-text-faint"
                    >
                      <ExternalLink className="tw-size-3.5" />
                    </span>
                  )}
                </span>
                <span className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
                  {candidate.folder && (
                    <span className="tw-min-w-0 tw-flex-1 tw-truncate">{candidate.folder}</span>
                  )}
                  {candidate.mtime > 0 && (
                    <span className={candidate.folder ? undefined : "tw-ml-auto"}>
                      {new Date(candidate.mtime).toLocaleDateString()}
                    </span>
                  )}
                </span>
                <span className="tw-w-full tw-truncate tw-text-xs tw-text-muted">
                  {candidate.snippet}
                </span>
                {displayScore !== null && (
                  <RelevanceMeter score={displayScore} animated={animated} className="tw-mt-1" />
                )}
              </button>
            </React.Fragment>
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
    () =>
      new Set(fileTypes.filter(({ checked }) => checked).flatMap(({ extensions }) => extensions)),
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
      prepareSearch: prepareFilenameSearch,
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
    allTypes: fileTypes.flatMap(({ extensions }) => extensions),
    miyoEnabled: shouldUseMiyo(settings),
    searchMiyo,
    prepareSearch: prepareFilenameSearch,
    mapMiyoPath: (path) => getVaultRelativeMiyoPath(app, path),
    booster,
    timerWindow,
  });
  const onTypeChange = (extensions: readonly string[], checked: boolean) => {
    const excluded = new Set(settings.vaultSearchExcludedFileTypes);
    for (const extension of extensions) {
      if (checked) excluded.delete(extension);
      else excluded.add(extension);
    }
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
      aiBoostAttemptCompleted={search.boostAttemptCompleted}
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
