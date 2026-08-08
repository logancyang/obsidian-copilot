import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import { Badge, type BadgeProps } from "./badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  args: { children: "Ready" },
  parameters: { gallery: { host: "leaf", layout: "centered" } },
} satisfies Meta<BadgeProps>;
export default meta;

export const Status: StoryObj<BadgeProps> = {};

export const Success: StoryObj<BadgeProps> = {
  args: { variant: "success", children: "Connected" },
};

export const Accent: StoryObj<BadgeProps> = {
  args: { variant: "accent", children: "Recommended" },
};

export const Variants: StoryObj<BadgeProps> = {
  render: () => (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="accent">Accent</Badge>
    </div>
  ),
};
