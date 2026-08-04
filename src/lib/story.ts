import type { ComponentType } from "react";

export type Host = "leaf" | "modal" | "popover" | "settings-tab";
export type Layout = "padded" | "centered" | "fullscreen";
export type GalleryWidth = 300 | 340 | 400 | 600;

/** Namespaced so it can never collide with a real Storybook addon's parameters. */
export interface GalleryParameters {
  gallery?: { host?: Host; layout?: Layout; width?: GalleryWidth; coverage?: boolean };
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
