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

export const InstructionsRowOnly: StoryObj<ProjectFilesListProps> = {};

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

export const UserAuthoredClaudeFile: StoryObj<ProjectFilesListProps> = {
  args: {
    files: [
      { path: "projects/Research/CLAUDE.md", name: "CLAUDE.md", extension: "md" },
      { path: "projects/Research/Q3 findings.pdf", name: "Q3 findings.pdf", extension: "pdf" },
    ],
  },
};

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
