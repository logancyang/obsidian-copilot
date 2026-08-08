import { ProjectFilesList, type ProjectFilesListProps } from "./ProjectInfoPopover";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Project Files List",
  component: ProjectFilesList,
  args: {
    files: [],
    onOpenInstructions: () => {},
    onOpenFile: () => {},
    onReveal: () => {},
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ProjectFilesListProps>;
export default meta;

/**
 * A project whose folder holds only its own bookkeeping. AGENTS.md is a fixed row rather than a
 * listed file, so it is present even though nothing else is.
 */
export const InstructionsRowOnly: StoryObj<ProjectFilesListProps> = {};

/**
 * The common case: `project.md` and `AGENTS.md` are represented by fixed rows or hidden, and a
 * CLAUDE.md carrying nothing but Copilot's `@AGENTS.md` import is filtered out upstream — so
 * only the user's own context files reach these rows.
 */
export const ContextFiles: StoryObj<ProjectFilesListProps> = {
  args: {
    files: [
      {
        path: "projects/Research/Interview transcript.md",
        name: "Interview transcript.md",
        extension: "md",
      },
      { path: "projects/Research/Q3 findings.pdf", name: "Q3 findings.pdf", extension: "pdf" },
      { path: "projects/Research/architecture.png", name: "architecture.png", extension: "png" },
    ],
  },
};

/**
 * A CLAUDE.md the user wrote their own rules into stays visible: Claude reads it as live
 * instructions, so hiding it the way the generated import-only wiring is hidden would leave
 * instructions in force with nothing in the UI to show for them.
 */
export const UserAuthoredClaudeFile: StoryObj<ProjectFilesListProps> = {
  args: {
    files: [
      { path: "projects/Research/CLAUDE.md", name: "CLAUDE.md", extension: "md" },
      { path: "projects/Research/Q3 findings.pdf", name: "Q3 findings.pdf", extension: "pdf" },
    ],
  },
};

/** Long names truncate rather than widening the popover or wrapping to a second line. */
export const LongFileNames: StoryObj<ProjectFilesListProps> = {
  args: {
    files: [
      {
        path: "projects/Research/Comparative analysis of retrieval strategies across vault sizes.md",
        name: "Comparative analysis of retrieval strategies across vault sizes.md",
        extension: "md",
      },
      {
        path: "projects/Research/2026-Q3-customer-interview-transcripts-consolidated.pdf",
        name: "2026-Q3-customer-interview-transcripts-consolidated.pdf",
        extension: "pdf",
      },
    ],
  },
};
