import React from "react";

interface DesktopOnlySettingsPanelProps {
  /**
   * What is unavailable, phrased for this specific panel. Required rather than
   * defaulted because every caller gates a different feature — one shared
   * sentence would be wrong for all but the panel it was written for.
   */
  message: string;
}

/**
 * Stand-in for a settings panel whose feature needs the desktop (Electron)
 * runtime. It renders nothing but the explanation, so it can be shown on mobile
 * without pulling the gated feature's module graph into the bundle.
 *
 * DESIGN NOTE — deliberately has no adjacent gallery story, despite the
 * component-gallery workflow in `designdocs/agents/TESTING_GUIDE.md`. The
 * gallery import fence (`eslint.config.mjs`) admits only UI primitives, shared
 * libraries, and the Obsidian host seams; `settings/v2/components/` is outside
 * it, so a story here fails lint rather than merely being low-value. Covering
 * it would mean relocating this component into `components/ui/`, which is a
 * bigger move than the one static sentence it renders can justify — and its two
 * real messages are already asserted in `DesktopOnlySettingsPanel.test.tsx`.
 * If a future review flags this again, point them at this note.
 */
export const DesktopOnlySettingsPanel: React.FC<DesktopOnlySettingsPanelProps> = ({ message }) => (
  <section className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4 tw-text-sm tw-text-muted">
    {message}
  </section>
);
