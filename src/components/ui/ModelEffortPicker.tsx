import { resolveEffort } from "@/lib/model-effort";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Button } from "@/components/ui/button";
import { FreeModelWarningIcon } from "@/components/ui/FreeModelWarningIcon";
import { LicenseRequiredIcon } from "@/components/ui/LicenseRequiredIcon";
import { MODEL_PICKER_PRICING_URL } from "@/components/ui/model-pricing-links";
import { SelfHostCloudWarningIcon } from "@/components/ui/SelfHostCloudWarningIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelDisplay } from "@/components/ui/model-display";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { AgentGlyph } from "@/components/ui/AgentGlyph";
import { SearchBar } from "@/components/ui/SearchBar";
import { getModelKeyFromModel } from "@/lib/model-key";
import { cn } from "@/lib/utils";

/** One agent the chat can be held with, and what picking it selects. */
export interface AgentPickerRow {
  slug: string;
  name: string;
  /** Emoji or letter; empty for an agent that set none. */
  icon: string;
  description: string;
  /**
   * Model row this agent pins, as a `getModelKeyFromModel` key, or null when it
   * pins none (or pins one this picker is not offering) and the drafted model
   * should be left where the user put it.
   */
  modelKey: string | null;
  /** Effort this agent pins, or null to leave the drafted effort alone. */
  effort: string | null;
}

/**
 * The Agent section at the top of the popover: who answers, chosen right above
 * what they answer on (`designdocs/CUSTOM_AGENTS.md` §3).
 */
export interface AgentPickerSection {
  /** The built-in Copilot first, then every agent on disk. */
  rows: readonly AgentPickerRow[];
  selectedSlug: string;
  /** Talk to this agent from the next chat on. */
  onSelect: (slug: string) => void;
  /** Called as the popover opens, so an agent created a moment ago is listed. */
  onOpen?: () => void;
}

/**
 * Roster size past which the nested list grows a search field. A team of this
 * many still reads at a glance; beyond it, scanning costs more than typing
 * (`designdocs/CUSTOM_AGENTS.md` §3).
 */
const AGENT_SEARCH_THRESHOLD = 6;

/**
 * The agents whose name or description matches `query`, case-insensitively.
 * Description is searched alongside name because it is what one agent in a team
 * is told apart from another by, and it is what the user was reading when they
 * decided to search.
 */
export function filterAgentRows(
  rows: readonly AgentPickerRow[],
  query: string
): readonly AgentPickerRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle)
  );
}

export interface ModelEffortPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  disabled?: boolean;
  /**
   * The active model's effort options + current value. `undefined` when the
   * currently selected model has no effort dimension (e.g. Haiku) — the
   * picker still surfaces, the trigger pill drops its effort suffix, and
   * the sticky footer reads "not applicable" for that row. Highlighted
   * rows that *do* have effort still expose their stepper normally.
   */
  effort?: {
    options: { label: string; value: string | null }[];
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  };
  effortOptionsByModelKey: Record<string, { label: string; value: string | null }[]>;
  commitSelection: (modelKey: string, effort: string | null) => void;
  /** Agent Mode only: the Agent section above the model and effort sections. */
  agents?: AgentPickerSection;
}

interface ModelEffortPickerProps {
  override: ModelEffortPickerOverride;
  className?: string;
  /** Opens the popover on mount, so a story can show the list it holds. */
  defaultOpen?: boolean;
}

/** Section heading above a group of rows, shared by the Agent and model groups. */
const GROUP_HEADING_CLASS = "tw-px-3 tw-pb-1 tw-pt-2 tw-text-xs tw-uppercase tw-tracking-wide";

/** One selectable row, shared by the Agent and model groups so both align. */
const ROW_CLASS =
  "tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-gap-3 tw-px-3 tw-py-1.5 tw-text-sm";

/*
 * Selection is color, not a marker column (`designdocs/CUSTOM_AGENTS.md` §3).
 * The row holding the current choice takes the accent tint an active fan-out
 * tab and the effort footer's active step already wear, and weights its name.
 * The name keeps the normal text color: a theme is free to pick an accent
 * bright enough that accent-on-tint falls under 4.5:1, and Atom's light theme
 * does, at 2.7:1.
 *
 * A row gets exactly one background — two background utilities would leave the
 * winner to stylesheet order — and the tint wins over the keyboard highlight,
 * because both lists open with the keyboard already on the current row and
 * that row has to read as the current one.
 */
const SELECTED_ROW_BG = "tw-bg-interactive-accent-hsl/10";
const SELECTED_ROW_NAME = "tw-font-medium";
const HIGHLIGHT_ROW_BG = "tw-bg-interactive-hover";

interface AgentPickerListProps {
  /** Rows to draw, already narrowed by {@link filterAgentRows}. */
  rows: readonly AgentPickerRow[];
  selectedSlug: string;
  /** Row the keyboard is on, drawn as hovered so Enter's target is visible. */
  highlightSlug?: string | null;
  /** Search field above the rows; present only past {@link AGENT_SEARCH_THRESHOLD}. */
  search?: { query: string; onChange: (query: string) => void };
  onPick: (row: AgentPickerRow) => void;
  /**
   * The pointer moved onto a row. The keyboard highlight follows it, the way a
   * menu's does, so hovering and arrowing never paint two rows at once.
   */
  onHighlight?: (row: AgentPickerRow) => void;
}

/**
 * The roster itself: everyone the chat could be held with, each with the glyph,
 * name, and description the choice is made on, the current one tinted. Pure
 * presentation — the caller owns the query, the highlight, and what picking a
 * row does.
 */
export const AgentPickerList: React.FC<AgentPickerListProps> = ({
  rows,
  onHighlight,
  selectedSlug,
  highlightSlug,
  search,
  onPick,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  // Keep the highlighted row in view: past six agents the list scrolls, so an
  // arrow press that moved the highlight below the fold would read as dead, and
  // a list opened on an agent far down it would open on strangers.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlightSlug]);
  return (
    <>
      {search && (
        <div className="tw-border-0 tw-border-b tw-border-solid tw-border-border tw-p-1">
          <SearchBar
            value={search.query}
            onChange={search.onChange}
            placeholder="Search agents..."
            inputClassName="!tw-h-7"
          />
        </div>
      )}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Agent"
        className="tw-max-h-64 tw-overflow-y-auto tw-py-1"
      >
        {rows.length === 0 ? (
          <div className="tw-px-3 tw-py-1.5 tw-text-xs tw-text-muted">No matching agents</div>
        ) : (
          rows.map((row) => {
            const isSelected = row.slug === selectedSlug;
            const isHighlight = row.slug === highlightSlug;
            return (
              <div
                key={row.slug}
                role="option"
                aria-selected={isSelected}
                data-highlighted={isHighlight || undefined}
                // Top-aligned: a description that wraps must not drag the agent's
                // face down to the middle of the block its name heads.
                className={cn(
                  ROW_CLASS,
                  "tw-items-start",
                  isSelected ? SELECTED_ROW_BG : isHighlight && HIGHLIGHT_ROW_BG
                )}
                onPointerMove={() => {
                  if (!isHighlight) onHighlight?.(row);
                }}
                onClick={() => onPick(row)}
              >
                <div className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
                  <AgentGlyph icon={row.icon} className="tw-h-5" />
                  <div className="tw-min-w-0">
                    <div
                      className={cn("tw-truncate tw-text-normal", isSelected && SELECTED_ROW_NAME)}
                    >
                      {row.name}
                    </div>
                    {row.description && (
                      // Wrapped, not truncated: the description is the whole basis
                      // on which the user picks one agent over another, and at this
                      // width a one-line clamp cut every real description mid-word.
                      <div
                        className="tw-line-clamp-2 tw-text-xs tw-text-muted"
                        title={row.description}
                      >
                        {row.description}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
};

AgentPickerList.displayName = "AgentPickerList";

interface AgentPickerSelectProps {
  section: AgentPickerSection;
  /** Apply this agent's pins to the drafted model and effort. */
  onPick: (row: AgentPickerRow) => void;
}

/**
 * The Agent section's single row — the current agent's glyph and name, with a
 * chevron — opening the roster as a second popover anchored to it
 * (`designdocs/CUSTOM_AGENTS.md` §3). A nested popover rather than an inline
 * expansion because a team of five to ten rendered in place would bury the
 * model and effort sections and move them under the user every time the list
 * opened.
 */
function AgentPickerSelect({ section, onPick }: AgentPickerSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightSlug, setHighlightSlug] = useState<string | null>(null);

  const current = section.rows.find((row) => row.slug === section.selectedSlug) ?? section.rows[0];
  const visible = useMemo(() => filterAgentRows(section.rows, query), [section.rows, query]);
  const highlightIndex = Math.max(
    0,
    visible.findIndex((row) => row.slug === highlightSlug)
  );

  const choose = useCallback(
    (row: AgentPickerRow) => {
      onPick(row);
      setOpen(false);
    },
    [onPick]
  );

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setQuery("");
      setHighlightSlug(section.selectedSlug);
    }
    setOpen(next);
  };

  // Arrows and Enter are the model list's keys too, and this popover renders
  // inside it, so every key this list consumes must stop there. Escape is left
  // alone: Radix dismisses only the topmost layer, which is this list.
  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (visible.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        setHighlightSlug(visible[(highlightIndex + 1) % visible.length].slug);
        break;
      case "ArrowUp":
        setHighlightSlug(visible[(highlightIndex - 1 + visible.length) % visible.length].slug);
        break;
      case "Enter":
        choose(visible[highlightIndex]);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div
          role="combobox"
          aria-label="Agent"
          aria-expanded={open}
          aria-haspopup="listbox"
          tabIndex={0}
          className={cn(ROW_CLASS, "hover:tw-bg-interactive-hover")}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            handleOpenChange(true);
          }}
        >
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <AgentGlyph icon={current.icon} />
            <span className="tw-truncate tw-text-normal">{current.name}</span>
          </div>
          <ChevronRight className="tw-size-4 tw-shrink-0 tw-text-muted" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="tw-w-[300px] tw-overflow-hidden tw-p-0"
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        onKeyDown={handleListKeyDown}
      >
        <AgentPickerList
          rows={visible}
          selectedSlug={section.selectedSlug}
          highlightSlug={highlightSlug}
          search={
            section.rows.length > AGENT_SEARCH_THRESHOLD ? { query, onChange: setQuery } : undefined
          }
          onPick={choose}
          onHighlight={(row) => setHighlightSlug(row.slug)}
        />
      </PopoverContent>
    </Popover>
  );
}

interface EffortOpt {
  label: string;
  value: string | null;
}

/**
 * Defers commit until popover dismisses. Without this the cross-backend pick
 * path swaps the active session mid-interaction, which would collapse the
 * popover before the user could pick an effort.
 */
export function ModelEffortPicker({ override, className, defaultOpen }: ModelEffortPickerProps) {
  const { models, value, effort, effortOptionsByModelKey, commitSelection, disabled, agents } =
    override;

  const [open, setOpen] = useState(defaultOpen ?? false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [draftModelKey, setDraftModelKey] = useState<string | null>(null);
  const [draftEffort, setDraftEffort] = useState<string | null>(null);
  const initialRef = useRef<{ model: string; effort: string | null }>({
    model: "",
    effort: null,
  });

  // Agent Mode entries are synthesized and never gated by BYOK API-key checks
  // (the backend manages its own credentials). `_disabledReason` is the only
  // opt-out.
  const enabledKeys = useMemo(() => {
    return models
      .filter((m) => (m.enabled ?? true) && !m._disabledReason)
      .map((m) => getModelKeyFromModel(m));
  }, [models]);

  const currentModel = models.find((m) => getModelKeyFromModel(m) === value);
  const currentEffortLabel = effort?.options.find((o) => o.value === effort.value)?.label ?? null;
  const activeEffortValue = effort?.value ?? null;

  // Initialize the draft + highlight on open, once. Picking an agent tells the
  // session manager at once, which re-renders this picker with fresh props; a
  // re-seed on those would throw away the pinned model and effort the pick had
  // just drafted (`designdocs/CUSTOM_AGENTS.md` §3).
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (!seededRef.current) {
      seededRef.current = true;
      /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- seed the editable draft from props when the popover opens; drafts are committed on close, so this can't be pure derived state */
      const initial = value && enabledKeys.includes(value) ? value : (enabledKeys[0] ?? null);
      setHighlightKey(initial);
      setDraftModelKey(initial);
      const initialOpts = initial ? (effortOptionsByModelKey[initial] ?? []) : [];
      const initialEffort = resolveEffort(
        initial === value ? activeEffortValue : null,
        initialOpts
      );
      setDraftEffort(initialEffort);
      initialRef.current = { model: value, effort: activeEffortValue };
      /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resume checking after draft initialization */
    }
  }, [open, value, enabledKeys, activeEffortValue, effortOptionsByModelKey]);

  const draftOptions: EffortOpt[] = useMemo(
    () => (draftModelKey ? (effortOptionsByModelKey[draftModelKey] ?? []) : []),
    [draftModelKey, effortOptionsByModelKey]
  );

  const moveHighlight = useCallback(
    (delta: 1 | -1) => {
      if (enabledKeys.length === 0) return;
      const idx = highlightKey ? enabledKeys.indexOf(highlightKey) : -1;
      let next = (idx + delta + enabledKeys.length) % enabledKeys.length;
      if (idx === -1) next = delta === 1 ? 0 : enabledKeys.length - 1;
      setHighlightKey(enabledKeys[next]);
    },
    [enabledKeys, highlightKey]
  );

  // Pick a row into the draft. Keep the current draftEffort when the new
  // row exposes it; otherwise fall back to the row's first option (or to
  // the active model's persisted effort if you just clicked back onto the
  // active row).
  const pickDraft = useCallback(
    (key: string) => {
      setDraftModelKey(key);
      setHighlightKey(key);
      const rowOpts = effortOptionsByModelKey[key] ?? [];
      setDraftEffort(resolveEffort(key === value ? activeEffortValue : draftEffort, rowOpts));
    },
    [effortOptionsByModelKey, draftEffort, value, activeEffortValue]
  );

  // Picking an agent applies its pins to the draft immediately, so the model and
  // effort sections show what this agent will actually run on before the popover
  // is dismissed (`designdocs/CUSTOM_AGENTS.md` §3). An agent with no pins
  // leaves both where the user left them.
  const pickAgent = useCallback(
    (row: AgentPickerRow) => {
      agents?.onSelect(row.slug);
      if (row.modelKey) pickDraft(row.modelKey);
      if (row.effort !== null) {
        const key = row.modelKey ?? draftModelKey;
        setDraftEffort(resolveEffort(row.effort, key ? (effortOptionsByModelKey[key] ?? []) : []));
      }
    },
    [agents, pickDraft, draftModelKey, effortOptionsByModelKey]
  );

  const stepDraftEffort = useCallback(
    (delta: 1 | -1) => {
      if (draftOptions.length === 0) return;
      const idx = draftOptions.findIndex((o) => o.value === draftEffort);
      const next = Math.max(0, Math.min(draftOptions.length - 1, (idx === -1 ? 0 : idx) + delta));
      setDraftEffort(draftOptions[next]?.value ?? null);
    },
    [draftOptions, draftEffort]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveHighlight(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveHighlight(-1);
        break;
      case "ArrowLeft":
        if (draftOptions.length > 0) {
          event.preventDefault();
          stepDraftEffort(-1);
        }
        break;
      case "ArrowRight":
        if (draftOptions.length > 0) {
          event.preventDefault();
          stepDraftEffort(1);
        }
        break;
      case "Enter":
        if (highlightKey) {
          event.preventDefault();
          pickDraft(highlightKey);
        }
        break;
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // The roster is read from the vault, so an agent created in Settings a
      // moment ago is listed without waiting for a reload.
      agents?.onOpen?.();
      setOpen(true);
      return;
    }
    if (draftModelKey) {
      const init = initialRef.current;
      const modelChanged = draftModelKey !== init.model;
      const effortChanged = draftEffort !== init.effort;
      if (modelChanged) {
        commitSelection(draftModelKey, draftEffort);
      } else if (effortChanged && effort) {
        effort.onChange(draftEffort);
      }
    }
    setOpen(false);
  };

  let lastGroup: string | undefined;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          disabled={disabled}
          className={cn("tw-min-w-0 tw-justify-start tw-text-muted", className)}
          title="Model · effort"
        >
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
            {currentModel ? (
              <ModelDisplay model={currentModel} iconSize={8} />
            ) : (
              <span className="tw-truncate">Select Model</span>
            )}
            {currentEffortLabel && (
              <>
                <span className="tw-text-faint" aria-hidden>
                  ·
                </span>
                <span className="tw-text-xs tw-text-muted">{currentEffortLabel}</span>
              </>
            )}
            {/* Persist the cloud-egress warning on the closed trigger too, so a
                selected cloud model under Self-Host Mode is flagged without opening
                the picker. stopPropagation=false so a click still opens it. */}
            {currentModel?._needsSelfHostWarning && (
              <SelfHostCloudWarningIcon stopPropagation={false} />
            )}
          </div>
          {!disabled && <ChevronDown className="tw-mt-0.5 tw-size-4 tw-shrink-0" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="tw-w-[380px] tw-overflow-hidden tw-p-0"
        align="start"
        side="top"
        sideOffset={4}
        onKeyDown={handleKeyDown}
      >
        <div className="tw-max-h-72 tw-overflow-y-auto tw-py-1">
          {agents && (
            <>
              <div className={cn(GROUP_HEADING_CLASS, "tw-text-faint")}>Agent</div>
              <AgentPickerSelect section={agents} onPick={pickAgent} />
              <div
                role="separator"
                className="tw-my-1 tw-border-0 tw-border-t tw-border-solid tw-border-border"
              />
            </>
          )}
          <div role="listbox" aria-label="Model">
            {models.map((entry) => {
              const Row = entry._needsLicense ? "a" : "div";
              const key = getModelKeyFromModel(entry);
              const disabledReason = entry._disabledReason;
              const itemDisabled = Boolean(disabledReason);
              // A locked Copilot row says why through its lock icon, so the
              // right-side label would only print that sentence twice.
              const rightLabel = entry._needsLicense ? null : (disabledReason ?? null);
              const isHighlight = key === highlightKey;
              const isActive = key === draftModelKey;
              const showHeader = entry._group !== undefined && entry._group !== lastGroup;
              const headerKey = `__group__${entry._group}__${key}`;
              lastGroup = entry._group;
              return (
                <React.Fragment key={key}>
                  {showHeader && (
                    <div key={headerKey} className={cn(GROUP_HEADING_CLASS, "tw-text-faint")}>
                      {entry._group}
                    </div>
                  )}
                  <Row
                    href={entry._needsLicense ? MODEL_PICKER_PRICING_URL : undefined}
                    target={entry._needsLicense ? "_blank" : undefined}
                    rel={entry._needsLicense ? "noopener noreferrer" : undefined}
                    role={entry._needsLicense ? undefined : "option"}
                    aria-selected={entry._needsLicense ? undefined : isActive}
                    aria-disabled={(!entry._needsLicense && itemDisabled) || undefined}
                    className={cn(
                      ROW_CLASS,
                      isActive ? SELECTED_ROW_BG : isHighlight && !itemDisabled && HIGHLIGHT_ROW_BG,
                      itemDisabled && "tw-opacity-50",
                      itemDisabled && !entry._needsLicense && "tw-cursor-not-allowed",
                      entry._needsLicense &&
                        "tw-text-normal tw-no-underline hover:tw-bg-interactive-hover hover:tw-text-normal hover:tw-no-underline focus-visible:tw-bg-interactive-hover"
                    )}
                    // Native Enter must follow the link, not draft the highlighted model;
                    // other keys must reach Radix's focus loop and dismissal handlers.
                    // https://github.com/Brevilabs/obsidian-copilot-private/issues/476
                    onKeyDown={
                      entry._needsLicense
                        ? (event) => {
                            if (event.key === "Enter") event.stopPropagation();
                          }
                        : undefined
                    }
                    onPointerMove={() => {
                      // Hover moves the highlight, so the mouse and the arrow keys
                      // paint the same single row.
                      if (!isHighlight && !itemDisabled) setHighlightKey(key);
                    }}
                    onAuxClick={(event) => {
                      // Middle-click follows the pricing link without firing onClick; discard its draft too.
                      // https://github.com/Brevilabs/obsidian-copilot-private/issues/476
                      if (entry._needsLicense && event.button === 1) setOpen(false);
                    }}
                    onClick={() => {
                      // Visiting pricing must discard pending model/effort edits, not commit on dismiss.
                      // https://github.com/Brevilabs/obsidian-copilot-private/issues/476
                      if (entry._needsLicense) {
                        setOpen(false);
                        return;
                      }
                      if (itemDisabled) return;
                      pickDraft(key);
                    }}
                    title={disabledReason ?? undefined}
                  >
                    <div className="tw-min-w-0">
                      <div
                        className={cn(
                          "tw-flex tw-min-w-0 tw-items-center tw-gap-1",
                          isActive && SELECTED_ROW_NAME
                        )}
                      >
                        <ModelDisplay model={entry} iconSize={12} />
                        {entry._needsLicense && <LicenseRequiredIcon />}
                        {entry._isFree && <FreeModelWarningIcon />}
                        {entry._needsSelfHostWarning && <SelfHostCloudWarningIcon />}
                      </div>
                      {entry._subtitle && (
                        <div className="tw-truncate tw-text-xs tw-text-muted">
                          {entry._subtitle}
                        </div>
                      )}
                    </div>
                    {rightLabel && (
                      <span className="tw-shrink-0 tw-text-xs tw-text-faint">{rightLabel}</span>
                    )}
                  </Row>
                </React.Fragment>
              );
            })}
          </div>
        </div>
        {/* Effort stepper for the drafted model — commit fires on popover close. */}
        <div className="tw-border-0 tw-border-t tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2">
          <EffortFooter options={draftOptions} value={draftEffort} onChange={setDraftEffort} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface EffortFooterProps {
  options: EffortOpt[];
  value: string | null;
  onChange: (value: string | null) => void;
}

function EffortFooter({ options, value, onChange }: EffortFooterProps) {
  const hasOptions = options.length > 0;
  const idx = hasOptions
    ? Math.max(
        0,
        options.findIndex((o) => o.value === value)
      )
    : 0;
  const currentLabel = hasOptions ? (options[idx]?.label ?? "") : "n/a";
  return (
    <div className="tw-flex tw-h-6 tw-items-center tw-justify-between tw-gap-3">
      <span className="tw-font-mono tw-text-[10px] tw-uppercase tw-tracking-wider tw-text-muted">
        Effort
      </span>
      <div className="tw-flex tw-items-center tw-gap-3">
        {hasOptions ? (
          <EffortStepper options={options} value={value} onChange={onChange} />
        ) : (
          <div className="tw-h-6 tw-w-[140px]" aria-hidden />
        )}
        <span
          className={cn(
            "tw-w-[72px] tw-truncate tw-rounded-md tw-px-2 tw-py-0.5 tw-text-center tw-font-mono tw-text-xs tw-font-medium",
            hasOptions
              ? "tw-bg-interactive-accent-hsl/10 tw-text-accent"
              : "tw-border tw-border-dashed tw-border-border tw-italic tw-text-faint"
          )}
        >
          {currentLabel}
        </span>
      </div>
    </div>
  );
}

interface EffortStepperProps {
  options: EffortOpt[];
  value: string | null;
  onChange: (value: string | null) => void;
}

/**
 * Discrete slider styled to match the HD "track + dots" variant: a 2px muted
 * base, ink-colored fill up to the current step, 6px step dots that flip from
 * hollow to filled as the range passes them, and a 24px white thumb with a
 * centered accent dot. Built on Radix `SliderPrimitive` so drag, click-snap,
 * and Arrow / Home / End keyboard support come for free.
 */
function EffortStepper({ options, value, onChange }: EffortStepperProps) {
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const max = Math.max(1, options.length - 1);
  return (
    <SliderPrimitive.Root
      min={0}
      max={max}
      step={1}
      value={[idx]}
      onValueChange={([next]) => {
        if (typeof next !== "number") return;
        const clamped = Math.max(0, Math.min(options.length - 1, next));
        onChange(options[clamped]?.value ?? null);
      }}
      aria-label="Effort"
      className="tw-relative tw-flex tw-h-6 tw-w-[140px] tw-touch-none tw-select-none tw-items-center"
    >
      <SliderPrimitive.Track className="tw-relative tw-mx-1.5 tw-h-0.5 tw-w-full tw-grow tw-rounded-full tw-bg-[var(--background-modifier-border)]">
        <SliderPrimitive.Range className="tw-absolute tw-h-full tw-rounded-full tw-bg-interactive-accent" />
      </SliderPrimitive.Track>
      {/* Step dots overlaid on the track. The 6px inset on each side matches
          the Track mx-1.5 so the dot for index 0 sits exactly at the track's
          left edge and index N-1 at the right edge. */}
      <div className="tw-pointer-events-none tw-absolute tw-inset-x-1.5 tw-top-1/2 -tw-translate-y-1/2">
        {options.map((opt, i) => {
          const left = options.length === 1 ? 50 : (i / (options.length - 1)) * 100;
          const filled = i <= idx;
          return (
            <span
              key={String(opt.value ?? `__default__${i}`)}
              aria-hidden
              className={cn(
                "tw-absolute tw-top-1/2 tw-size-1.5 -tw-translate-x-1/2 -tw-translate-y-1/2 tw-rounded-full",
                filled
                  ? "tw-bg-interactive-accent"
                  : "tw-border-[1.5px] tw-border-solid tw-border-border tw-bg-primary"
              )}
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>
      <SliderPrimitive.Thumb
        aria-label="Effort"
        className="tw-flex tw-size-6 tw-items-center tw-justify-center tw-rounded-full tw-border-[1.5px] tw-border-solid tw-border-border tw-bg-primary tw-shadow-sm tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring focus-visible:tw-ring-offset-1 disabled:tw-pointer-events-none disabled:tw-opacity-50"
      >
        <span aria-hidden className="tw-size-2 tw-rounded-full tw-bg-interactive-accent" />
      </SliderPrimitive.Thumb>
    </SliderPrimitive.Root>
  );
}
