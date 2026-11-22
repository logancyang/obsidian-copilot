import { AGENTS_MENTION_CATEGORY, agentMentionOptions } from "@/agents/ui/agentMentionOptions";
import {
  COCO,
  LEO,
  LONG_NAMED_AGENT,
  MAYA,
  NORA,
  THREE_AGENTS,
} from "@/agents/ui/testing/rosterFixtures";
import {
  TypeaheadMenuContent,
  type TypeaheadMenuContentProps,
  type TypeaheadOption,
} from "./TypeaheadMenuContent";
import type { Meta, StoryObj } from "@/lib/story";
import { FileClock, FileText, Folder, Globe } from "lucide-react";
import React from "react";

const ACTIVE_NOTE: TypeaheadOption = {
  key: "active-note",
  title: "Active Note",
  icon: <FileClock className="tw-size-4" />,
};

const CATEGORIES: TypeaheadOption[] = [
  AGENTS_MENTION_CATEGORY,
  { key: "notes", title: "Notes", icon: <FileText className="tw-size-4" /> },
  { key: "webTabs", title: "Web tabs", icon: <Globe className="tw-size-4" /> },
  { key: "folders", title: "Folders", icon: <Folder className="tw-size-4" /> },
];

const NOTE_MATCHES: TypeaheadOption[] = [
  {
    key: "note-ledger",
    title: "Ledger rules",
    subtitle: "Finance/Ledger rules.md",
    icon: <FileText className="tw-size-4" />,
  },
  {
    key: "note-lessons",
    title: "Lessons from the 4.0 launch",
    subtitle: "Launches/Lessons from the 4.0 launch.md",
    icon: <FileText className="tw-size-4" />,
  },
  {
    key: "folder-legal",
    title: "Legal",
    subtitle: "FiliQ/Legal",
    icon: <Folder className="tw-size-4" />,
  },
];

const NOOP = () => undefined;

function menu(
  options: TypeaheadOption[],
  query = "",
  mode: TypeaheadMenuContentProps["mode"] = "category"
): TypeaheadMenuContentProps {
  return { options, selectedIndex: 0, onSelect: NOOP, onHighlight: NOOP, mode, query };
}

const meta = {
  title: "Copilot Teammates/Mention Menu",
  component: TypeaheadMenuContent,
  parameters: { gallery: { host: "popover", layout: "centered" } },
} satisfies Meta<TypeaheadMenuContentProps>;
export default meta;

export const FirstLevel: StoryObj<TypeaheadMenuContentProps> = {
  args: menu(CATEGORIES),
};

export const FirstLevelWithActiveNote: StoryObj<TypeaheadMenuContentProps> = {
  args: menu([ACTIVE_NOTE, ...CATEGORIES]),
};

export const AgentsInAnAgentChat: StoryObj<TypeaheadMenuContentProps> = {
  args: menu(agentMentionOptions([MAYA, LEO, NORA], ""), "", "search"),
};

export const AgentsWithAQuery: StoryObj<TypeaheadMenuContentProps> = {
  args: menu(agentMentionOptions([...THREE_AGENTS, NORA], "o"), "o", "search"),
};

export const FirstLevelWithAQuery: StoryObj<TypeaheadMenuContentProps> = {
  args: menu([...agentMentionOptions([MAYA, LEO, NORA], "le"), ...NOTE_MATCHES], "le"),
};

export const LongName: StoryObj<TypeaheadMenuContentProps> = {
  args: menu(agentMentionOptions([COCO, LONG_NAMED_AGENT], ""), "", "search"),
};
