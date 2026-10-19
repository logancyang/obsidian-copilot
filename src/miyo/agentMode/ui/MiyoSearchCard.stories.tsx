import { MiyoSearchCard } from "@/miyo/agentMode/ui/MiyoSearchCard";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type MiyoSearchCardProps = React.ComponentProps<typeof MiyoSearchCard>;

const meta = {
  title: "Agent Mode/Miyo Search Card",
  component: MiyoSearchCard,
  args: { status: "completed", query: "back pain and standing desk", noteCount: 4 },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<MiyoSearchCardProps>;
export default meta;

export const Running: StoryObj<MiyoSearchCardProps> = {
  args: { status: "in_progress", noteCount: null },
};

export const Completed: StoryObj<MiyoSearchCardProps> = {};

export const SingleNote: StoryObj<MiyoSearchCardProps> = {
  args: { query: "tariff code ZX-4471", noteCount: 1 },
};

export const Empty: StoryObj<MiyoSearchCardProps> = {
  args: { query: "quarterly offsite agenda", noteCount: 0 },
};

export const Failed: StoryObj<MiyoSearchCardProps> = {
  args: { status: "failed", noteCount: null },
};

export const FailedWithError: StoryObj<MiyoSearchCardProps> = {
  args: {
    status: "failed",
    noteCount: null,
    error:
      "Miyo search failed. Continue with keyword search and tell the user to open Miyo. Details: net::ERR_CONNECTION_REFUSED",
  },
};

export const CountUnavailable: StoryObj<MiyoSearchCardProps> = {
  args: { noteCount: null },
};

export const LongQuery: StoryObj<MiyoSearchCardProps> = {
  args: {
    query:
      "what did I decide about the migration plan for the shared calendar service and who owns the rollout checklist",
    noteCount: 12,
  },
};
