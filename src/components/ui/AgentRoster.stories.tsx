import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";
import { AgentSpotlight, type AgentPickerRow } from "./AgentRoster";

function portrait(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="26" r="11" fill="#ffffffcc"/><ellipse cx="32" cy="58" rx="20" ry="16" fill="#ffffffcc"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function row(
  slug: string,
  name: string,
  description: string,
  avatarSrc: string | null = null
): AgentPickerRow {
  return { slug, name, avatarSrc, description };
}

const COPILOT = row("copilot", "Copilot", "Your vault instructions, no persona, no memory.");

const TEAM: AgentPickerRow[] = [
  row(
    "sage",
    "Sage",
    "Chief of staff. Tracks decisions, open loops, and what you promised.",
    portrait("#2f6f73", "#7fb7a4")
  ),
  row(
    "rex",
    "Rex",
    "Red team. Argues against whatever you propose.",
    portrait("#7a2e2e", "#d0674f")
  ),
  row("pip", "Pip", "Explains anything to a nine-year-old. Sixty words, one analogy."),
];

const MORE: AgentPickerRow[] = [
  row("quill", "Quill", "Vault archivist. Answers only from your notes."),
  row("haiku", "Haiku", "Answers only in haiku."),
  row("jennifer", "Jennifer", "Skeptical editor. Cuts fluff.", portrait("#5b3a7a", "#b48ad8")),
  row("ben", "Ben", "Cuts to the point."),
  row("dom", "Dom", "Finds something positive in any situation."),
  row("jesse", "Jesse", "Educator. Helps you understand the idea."),
  row("vancat", "Vancat", "Enthusiastic hype-writer."),
  row("codex", "Codex", "Raw Codex backend. No persona, no memory."),
  row(
    "atlas",
    "Atlas",
    "Trip planner with a very long description that has to clamp to two lines rather than push the strip down the pane."
  ),
];

const LONG_NAME = row(
  "marguerite",
  "Marguerite-Anastasia Featherstonehaugh, Chief of Household Logistics",
  "Family scheduler. Knows the kids' activities and everyone's availability."
);

interface CanvasProps {
  rows: AgentPickerRow[];
  initial: string;
}

function SpotlightCanvas({ rows, initial }: CanvasProps) {
  const [selectedSlug, setSelectedSlug] = useState(initial);
  return (
    <AgentSpotlight
      section={{ rows, selectedSlug, onSelect: (picked) => setSelectedSlug(picked.slug) }}
      onCreateAgent={() => {}}
      onOpenAgent={() => {}}
      onOpenScratchpad={() => {}}
    />
  );
}

const meta = {
  title: "UI/Agent Roster",
  component: SpotlightCanvas,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<CanvasProps>;
export default meta;

export const NoAgentsYet: StoryObj<CanvasProps> = {
  name: "Spotlight — only Copilot and New",
  args: { rows: [COPILOT], initial: "copilot" },
};

export const ThreeAgents: StoryObj<CanvasProps> = {
  name: "Spotlight — three agents, image avatar picked",
  args: { rows: [COPILOT, ...TEAM], initial: "sage" },
};

export const EmojiAgentPicked: StoryObj<CanvasProps> = {
  name: "Spotlight — agent without an image picked",
  args: { rows: [COPILOT, ...TEAM], initial: "pip" },
};

export const TwelveAgents: StoryObj<CanvasProps> = {
  name: "Spotlight — twelve agents, the rest behind +N",
  args: { rows: [COPILOT, ...TEAM, ...MORE], initial: "jennifer" },
};

export const LongDescription: StoryObj<CanvasProps> = {
  name: "Spotlight — long description ellipsizes on one line",
  args: { rows: [COPILOT, ...TEAM, ...MORE], initial: "atlas" },
};

export const LongName: StoryObj<CanvasProps> = {
  name: "Spotlight — long name truncates beside the scratchpad icon",
  args: { rows: [COPILOT, ...TEAM, LONG_NAME], initial: "marguerite" },
};
