import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { TriangleAlert } from "lucide-react";

interface SettingSectionProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  gated?: boolean;
  gateNotice?: React.ReactNode;
}

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
        <div className="tw-divide-y tw-divide-border [&>*]:tw-px-4">{children}</div>
      </div>
    </div>
  );
}
