import React from "react";

interface DesktopOnlySettingsPanelProps {
  message: string;
}

export const DesktopOnlySettingsPanel: React.FC<DesktopOnlySettingsPanelProps> = ({ message }) => (
  <section className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4 tw-text-sm tw-text-muted">
    {message}
  </section>
);
