import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Button } from "@/components/ui/button";
import { FreeModelWarningIcon } from "@/components/ui/FreeModelWarningIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ModelDisplay } from "@/components/ui/model-display";
import { type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { getModelKeyFromModel } from "@/settings/model";
import { cn } from "@/lib/utils";

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
}

interface ModelEffortPickerProps {
  override: ModelEffortPickerOverride;
  className?: string;
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
export function ModelEffortPicker({ override, className }: ModelEffortPickerProps) {
  const { models, value, effort, effortOptionsByModelKey, commitSelection, disabled } = override;

  const [open, setOpen] = useState(false);
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

  // Initialize the draft + highlight on open. Re-running on `value`
  // changes is fine: while the popover is open the parent shouldn't
  // change `value` (commits are deferred), so this effectively only fires
  // on open.
  useEffect(() => {
    if (open) {
      /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- seed the editable draft from props when the popover opens; drafts are committed on close, so this can't be pure derived state */
      const initial = value && enabledKeys.includes(value) ? value : (enabledKeys[0] ?? null);
      setHighlightKey(initial);
      setDraftModelKey(initial);
      const initialOpts = initial ? (effortOptionsByModelKey[initial] ?? []) : [];
      const initialEffort =
        initial === value && activeEffortValue !== null
          ? activeEffortValue
          : initialOpts.length > 0
            ? (initialOpts[0]?.value ?? null)
            : null;
      setDraftEffort(initialEffort);
      initialRef.current = { model: value, effort: activeEffortValue };
      /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
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
      if (rowOpts.length === 0) {
        setDraftEffort(null);
        return;
      }
      const stillValid = rowOpts.some((o) => o.value === draftEffort);
      if (stillValid) return;
      setDraftEffort(
        key === value && activeEffortValue !== null
          ? activeEffortValue
          : (rowOpts[0]?.value ?? null)
      );
    },
    [effortOptionsByModelKey, draftEffort, value, activeEffortValue]
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
          </div>
          {!disabled && <ChevronDown className="tw-mt-0.5 tw-size-4 tw-shrink-0" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="tw-w-[380px] tw-p-0"
        align="start"
        side="top"
        sideOffset={4}
        onKeyDown={handleKeyDown}
      >
        <div className="tw-max-h-72 tw-overflow-y-auto tw-py-1" role="listbox" aria-label="Model">
          {models.map((entry) => {
            const key = getModelKeyFromModel(entry);
            const disabledReason = entry._disabledReason;
            const itemDisabled = Boolean(disabledReason);
            const rightLabel = disabledReason ?? null;
            const isHighlight = key === highlightKey;
            const isActive = key === draftModelKey;
            const showHeader = entry._group !== undefined && entry._group !== lastGroup;
            const headerKey = `__group__${entry._group}__${key}`;
            lastGroup = entry._group;
            return (
              <React.Fragment key={key}>
                {showHeader && (
                  <div
                    key={headerKey}
                    className="tw-px-3 tw-pb-1 tw-pt-2 tw-text-xs tw-uppercase tw-tracking-wide tw-text-faint"
                  >
                    {entry._group}
                  </div>
                )}
                <div
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={itemDisabled || undefined}
                  className={cn(
                    "tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-gap-3 tw-px-3 tw-py-1.5 tw-text-sm",
                    isHighlight && !itemDisabled && "tw-bg-interactive-hover",
                    itemDisabled && "tw-cursor-not-allowed tw-opacity-50"
                  )}
                  onClick={() => {
                    if (itemDisabled) return;
                    pickDraft(key);
                  }}
                  title={disabledReason ?? undefined}
                >
                  <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                    <span
                      className="tw-flex tw-w-3 tw-shrink-0 tw-items-center tw-justify-center tw-text-xs tw-text-muted"
                      aria-hidden
                    >
                      {isActive ? "✓" : isHighlight ? "›" : ""}
                    </span>
                    <div className="tw-min-w-0">
                      <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
                        <ModelDisplay model={entry} iconSize={12} />
                        {entry._isFree && <FreeModelWarningIcon />}
                      </div>
                      {entry._subtitle && (
                        <div className="tw-truncate tw-text-xs tw-text-muted">
                          {entry._subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                  {rightLabel && (
                    <span className="tw-shrink-0 tw-text-xs tw-text-faint">{rightLabel}</span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        {/* Effort stepper for the drafted model — commit fires on popover close. */}
        <div className="tw-border-t tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2">
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
