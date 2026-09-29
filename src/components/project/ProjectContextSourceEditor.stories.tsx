import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import { ProjectContextSourceEditor } from "./ProjectContextSourceEditor";

type Props = React.ComponentProps<typeof ProjectContextSourceEditor>;

const patterns = (...raw: string[]) => raw.map(encodeURIComponent).join(",");

const noop = () => {};

const meta = {
  title: "Project/Context Source Editor",
  component: ProjectContextSourceEditor,
  args: { onChange: noop, onManage: noop },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const AllSourceTypes: StoryObj<Props> = {
  args: {
    showHelperText: true,
    contextSource: {
      inclusions: patterns(
        "notes/research",
        "#machine-learning",
        "[[Project Brief]]",
        "*.pdf",
        "[Topics:Physics]"
      ),
    },
  },
};

export const PropertyLabelForms: StoryObj<Props> = {
  args: {
    contextSource: {
      inclusions: patterns("[Topics:Physics]", "[Subject:]", "[Status:In Progress]"),
    },
  },
};

export const WithExclusions: StoryObj<Props> = {
  args: {
    contextSource: {
      inclusions: patterns("notes/research", "[Topics:Physics]"),
      exclusions: patterns("notes/archive", "[Status:Draft]"),
    },
  },
};

export const Empty: StoryObj<Props> = {
  args: { contextSource: { inclusions: "", exclusions: "" } },
};
