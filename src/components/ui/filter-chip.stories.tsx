import { FilterChip, type FilterChipProps } from "@/components/ui/filter-chip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const meta = {
  title: "UI/Filter Chip",
  component: FilterChip,
  args: { pressed: true, count: 12, children: "epub" },
  parameters: { gallery: { host: "leaf", layout: "centered" } },
} satisfies Meta<FilterChipProps>;
export default meta;

export const States: StoryObj<FilterChipProps> = {
  render: () => (
    <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
      <FilterChip pressed count={12}>
        On
      </FilterChip>
      <FilterChip pressed={false} count={12}>
        Off
      </FilterChip>
      <FilterChip pressed count={12} className="!tw-bg-interactive-accent-hover">
        Hover
      </FilterChip>
      <FilterChip pressed count={12} disabled>
        Disabled
      </FilterChip>
    </div>
  ),
};
