import type { ComponentType } from "react";

export type Host = "leaf" | "modal" | "popover" | "settings-tab";
export type Layout = "padded" | "centered" | "fullscreen";

export interface GalleryParameters {
  gallery?: {
    host?: Host;
    layout?: Layout;
    coverage?: boolean;
    modalClass?: string;
  };
}

export interface Meta<P = unknown> {
  title: string;
  component?: ComponentType<P>;
  args?: Partial<P>;
  parameters?: GalleryParameters;
}

export interface StoryObj<P = unknown> {
  name?: string;
  args?: Partial<P>;
  render?: ComponentType<Partial<P>>;
  parameters?: GalleryParameters;
}
