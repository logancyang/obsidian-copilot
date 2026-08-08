import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { TriangleAlert } from "lucide-react";

interface SettingSectionProps {
  /** Small sentence-case label rendered above the card (e.g. "General", "Connection"). */
  label?: React.ReactNode;
  /** Optional muted line under the label, above the card (e.g. a legend or hint). */
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** When true the card dims and becomes non-interactive (keyboard included). */
  gated?: boolean;
  /** Notice shown above a gated card explaining how to ungate it. */
  gateNotice?: React.ReactNode;
}

/**
 * Section card container for grouped settings — the v4 layout primitive.
 * A small sentence-case label sits above a hairline-bordered card whose rows
 * (typically `SettingItem`) are separated by full-width dividers.
 *
 * Padding lives on each row wrapper (not the card) so the dividers run edge to
 * edge while the row content stays inset — otherwise `px` on the card would push
 * the dividers in and the rows would read as separate boxed segments.
 *
 * When `gated`, the card dims and the `inert` attribute is applied so its rows
 * drop out of tab order and ignore pointer input. `inert` isn't typed in
 * @types/react@18, so it's toggled via a ref rather than a JSX prop.
 */
export function SettingSection({
  label,
  description,
  children,
  className,
  gated = false,
  gateNotice,
}: SettingSectionProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (gated) {
      card.setAttribute("inert", "");
    } else {
      card.removeAttribute("inert");
    }
  }, [gated]);

  return (
    <div className={cn("tw-space-y-2", className)}>
      {(label || description) && (
        <div className="tw-space-y-1">
          {label && <div className="tw-text-xs tw-font-semibold tw-text-muted">{label}</div>}
          {description && <div className="tw-text-sm tw-text-muted">{description}</div>}
        </div>
      )}
      {gated && gateNotice && (
        <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-px-3 tw-py-2.5 tw-text-xs tw-text-warning tw-bg-warning/10 tw-border-warning/30">
          <TriangleAlert className="tw-mt-0.5 tw-size-4 tw-shrink-0" />
          <div>{gateNotice}</div>
        </div>
      )}
      <div
        ref={cardRef}
        className={cn(
          "tw-overflow-hidden tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-sm",
          gated && "tw-opacity-45"
        )}
      >
        {/* Canonical divided-row pattern (see GlobalRecentChatsSection /
            ProjectPickerList): `divide-y divide-border` only — adding
            `divide-solid` makes each row show a full 4-side border in Obsidian.
            px-4 on each row keeps the dividers full-width, content inset. */}
        <div className="tw-divide-y tw-divide-border [&>*]:tw-px-4">{children}</div>
      </div>
    </div>
  );
}
