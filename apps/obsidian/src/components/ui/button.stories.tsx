import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import { Button, type ButtonProps } from "./button";

const VARIANTS = [
  "default",
  "destructive",
  "secondary",
  "ghost",
  "link",
  "success",
  "ghost2",
] as const;
const SIZES = ["default", "sm", "lg", "icon", "fit"] as const;

const meta = {
  title: "UI/Button",
  component: Button,
  args: { type: "button" },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ButtonProps>;
export default meta;

export const Disabled: StoryObj<ButtonProps> = {
  args: { disabled: true, children: "Working…" },
};

export const Variants: StoryObj<ButtonProps> = {
  render: () => (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      {VARIANTS.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

export const Sizes: StoryObj<ButtonProps> = {
  render: () => (
    <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
      {SIZES.map((size) => (
        <Button key={size} size={size}>
          {size}
        </Button>
      ))}
    </div>
  ),
};
