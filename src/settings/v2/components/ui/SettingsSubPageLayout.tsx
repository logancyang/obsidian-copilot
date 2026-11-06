import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import React from "react";

export interface SettingsSubPageLayoutProps {
  title: string;
  description?: React.ReactNode;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  onBack: () => void;
  children: React.ReactNode;
}

export const SettingsSubPageLayout: React.FC<SettingsSubPageLayoutProps> = ({
  title,
  description,
  toolbar,
  footer,
  onBack,
  children,
}) => (
  <div className="tw-flex tw-h-full tw-flex-col tw-gap-3">
    <Button variant="ghost" size="sm" className="tw-self-start tw-px-2" onClick={onBack} autoFocus>
      <ArrowLeft className="tw-size-4" />
      Back
    </Button>
    <div className="tw-space-y-1">
      <div role="heading" aria-level={2} className="tw-text-base tw-font-semibold">
        {title}
      </div>
      {description && <div className="tw-text-sm tw-text-muted">{description}</div>}
    </div>
    {toolbar}
    <div
      role="region"
      aria-label={title}
      className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-4 tw-shadow-sm"
    >
      {children}
    </div>
    {footer}
  </div>
);
