import type { ComponentType } from "react";

export type Host = "leaf" | "modal" | "popover" | "settings-tab";
export type Layout = "padded" | "centered" | "fullscreen";

/**
 * Namespaced so it can never collide with a real Storybook addon's parameters.
 *
 * Deliberately has no `width`: canvas width is view state owned by the gallery's
 * width toolbar and persisted per view, so a story that declared one would be
 * honoured on the very first render and silently ignored from then on. Check a
 * component at other widths with the toolbar, or sweep them all via `audit()`.
 */
export interface GalleryParameters {
  gallery?: {
    host?: Host;
    layout?: Layout;
    coverage?: boolean;
    /**
     * Class for the `modal` host's frame, mirroring the `modalClass` the
     * component's production `ReactModal` passes. Components whose layout
     * depends on a frame-level rule (a full-bleed dialog stripping the frame's
     * padding, say) need it here too, or the story renders in a frame the real
     * one never has.
     */
    modalClass?: string;
  };
}

/** Strict subset of CSF3 ComponentAnnotations. */
export interface Meta<P = unknown> {
  title: string;
  component?: ComponentType<P>;
  args?: Partial<P>;
  parameters?: GalleryParameters;
}

/** Strict subset of CSF3 StoryAnnotations. */
export interface StoryObj<P = unknown> {
  name?: string;
  args?: Partial<P>;
  render?: ComponentType<Partial<P>>;
  parameters?: GalleryParameters;
}
