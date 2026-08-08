import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import { ProjectContextBadgeList } from "./ProjectContextBadgeList";

type Props = React.ComponentProps<typeof ProjectContextBadgeList>;

/**
 * Patterns are persisted URL-encoded and comma-joined, so fixtures encode the
 * same way the settings value does rather than passing raw bracket syntax.
 */
const patterns = (...raw: string[]) => raw.map(encodeURIComponent).join(",");

const meta = {
  title: "Project/Context Badge List",
  component: ProjectContextBadgeList,
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

/** All five source types together — the only place their icons and hues are compared. */
export const AllSourceTypes: StoryObj<Props> = {
  args: {
    inclusions: patterns(
      "notes/research",
      "#machine-learning",
      "[[Project Brief]]",
      "*.pdf",
      "[Topics:Physics]"
    ),
  },
};

/**
 * The two property label shapes. Unlike the other four types, a property badge
 * renders a *transformed* label, so both forms need to be legible as such.
 */
export const PropertyLabelForms: StoryObj<Props> = {
  args: {
    inclusions: patterns("[Topics:Physics]", "[Subject:]", "[Status:In Progress]"),
  },
};

/** A property value long enough to hit the badge's truncation boundary. */
export const LongPropertyValue: StoryObj<Props> = {
  args: {
    inclusions: patterns("[Subject:Quantum Mechanics and General Relativity]", "[Topics:Physics]"),
  },
};

/** Exclusions render dimmed beside inclusions of the same types. */
export const WithExclusions: StoryObj<Props> = {
  args: {
    inclusions: patterns("notes/research", "[Topics:Physics]"),
    exclusions: patterns("notes/archive", "[Status:Draft]"),
  },
};

/** Passing the change handlers turns every badge into a removable chip. */
export const Removable: StoryObj<Props> = {
  args: {
    inclusions: patterns("notes/research", "#machine-learning", "[Topics:Physics]", "*.pdf"),
    exclusions: patterns("[Status:Draft]"),
    onInclusionsChange: () => {},
    onExclusionsChange: () => {},
  },
};

/** Enough sources to exceed the collapsed height and expose the expand control. */
export const Overflowing: StoryObj<Props> = {
  args: {
    maxCollapsedHeight: 64,
    inclusions: patterns(
      "notes/research",
      "notes/archive",
      "notes/daily",
      "#machine-learning",
      "#physics",
      "[[Project Brief]]",
      "[[Reading List]]",
      "*.pdf",
      "*.docx",
      "[Topics:Physics]",
      "[Topics:Chemistry]",
      "[Subject:]"
    ),
  },
};

/** No sources configured — the empty state the editor shows before any pick. */
export const Empty: StoryObj<Props> = {
  args: { inclusions: "", exclusions: "" },
};
