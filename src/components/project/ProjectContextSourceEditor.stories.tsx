import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import { ProjectContextSourceEditor } from "./ProjectContextSourceEditor";

type Props = React.ComponentProps<typeof ProjectContextSourceEditor>;

/**
 * Patterns are persisted URL-encoded and comma-joined, so fixtures encode the
 * same way the settings value does rather than passing raw bracket syntax.
 */
const patterns = (...raw: string[]) => raw.map(encodeURIComponent).join(",");

const noop = () => {};

const meta = {
  title: "Project/Context Source Editor",
  component: ProjectContextSourceEditor,
  args: { onChange: noop, onManage: noop },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

/**
 * All five source types together. This editor keeps its own chip icons and hues
 * rather than reusing ProjectContextBadgeList's pills, so property's glyph and
 * color need comparing against its siblings here too. `showHelperText` renders
 * the description that names the supported source types.
 */
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

/**
 * The two property label shapes. Unlike the other four types, a property chip
 * renders a *transformed* label via `getBadgeLabel`, so both forms need to be
 * legible as such.
 */
export const PropertyLabelForms: StoryObj<Props> = {
  args: {
    contextSource: {
      inclusions: patterns("[Topics:Physics]", "[Subject:]", "[Status:In Progress]"),
    },
  },
};

/** Excluded property chips render dimmed below the divider. */
export const WithExclusions: StoryObj<Props> = {
  args: {
    contextSource: {
      inclusions: patterns("notes/research", "[Topics:Physics]"),
      exclusions: patterns("notes/archive", "[Status:Draft]"),
    },
  },
};

/** The empty placeholder, whose hint names the source types Manage can add. */
export const Empty: StoryObj<Props> = {
  args: { contextSource: { inclusions: "", exclusions: "" } },
};
