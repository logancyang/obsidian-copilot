import {
  ADDED_LIST_ITEM,
  BLOCK_MOVED,
  CJK_EDIT,
  CODE_BLOCK_LINE_CHANGE,
  FILE_CREATED,
  FILE_EMPTIED,
  FRONTMATTER_TAG_ADDED,
  FRONTMATTER_UNCHANGED_BODY_EDIT,
  HEADING_LEVEL_CHANGE,
  LINK_HREF_CHANGE,
  NON_MARKDOWN_FILE,
  REMOVED_LIST_ITEM,
  TABLE_CELL_EDIT,
  TABLE_ROW_ADDED,
  TABLE_ROW_REMOVED,
  TASK_CHECKBOX_TOGGLED,
  WHOLE_NOTE,
  WIKILINK_RENAME,
  WORDING_CHANGE,
  type RenderedDiffFixture,
} from "@/agentMode/ui/renderedDiff/fixtures";
import { RenderedDiff, type RenderedDiffProps } from "@/agentMode/ui/renderedDiff/RenderedDiff";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Rendered Diff",
  component: RenderedDiff,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<RenderedDiffProps>;
export default meta;

const story = (fixture: RenderedDiffFixture): StoryObj<RenderedDiffProps> => ({ args: fixture });

export const WholeNote: StoryObj<RenderedDiffProps> = story(WHOLE_NOTE);

export const WordingChange: StoryObj<RenderedDiffProps> = story(WORDING_CHANGE);

export const HeadingLevelChange: StoryObj<RenderedDiffProps> = story(HEADING_LEVEL_CHANGE);

export const AddedListItem: StoryObj<RenderedDiffProps> = story(ADDED_LIST_ITEM);

export const RemovedListItem: StoryObj<RenderedDiffProps> = story(REMOVED_LIST_ITEM);

export const TaskCheckboxToggled: StoryObj<RenderedDiffProps> = story(TASK_CHECKBOX_TOGGLED);

export const LinkHrefChange: StoryObj<RenderedDiffProps> = story(LINK_HREF_CHANGE);

export const WikilinkRename: StoryObj<RenderedDiffProps> = story(WIKILINK_RENAME);

export const TableCellEdit: StoryObj<RenderedDiffProps> = story(TABLE_CELL_EDIT);

export const TableRowAdded: StoryObj<RenderedDiffProps> = story(TABLE_ROW_ADDED);

export const TableRowRemoved: StoryObj<RenderedDiffProps> = story(TABLE_ROW_REMOVED);

export const CodeBlockLineChange: StoryObj<RenderedDiffProps> = story(CODE_BLOCK_LINE_CHANGE);

export const FrontmatterTagAdded: StoryObj<RenderedDiffProps> = story(FRONTMATTER_TAG_ADDED);

export const FrontmatterUnchanged: StoryObj<RenderedDiffProps> = story(
  FRONTMATTER_UNCHANGED_BODY_EDIT
);

export const BlockMoved: StoryObj<RenderedDiffProps> = story(BLOCK_MOVED);

export const CjkEdit: StoryObj<RenderedDiffProps> = story(CJK_EDIT);

export const FileCreated: StoryObj<RenderedDiffProps> = story(FILE_CREATED);

export const FileEmptied: StoryObj<RenderedDiffProps> = story(FILE_EMPTIED);

export const NonMarkdownFile: StoryObj<RenderedDiffProps> = story(NON_MARKDOWN_FILE);

export const FinalNewlineAdded: StoryObj<RenderedDiffProps> = {
  args: { path: "config.json", before: '{"ready":true}', after: '{"ready":true}\n' },
};

export const FinalNewlineRemoved: StoryObj<RenderedDiffProps> = {
  args: { path: "config.json", before: '{"ready":true}\n', after: '{"ready":true}' },
};

export const ReservedMarkerFallback: StoryObj<RenderedDiffProps> = {
  args: {
    path: "notes/Imported symbols.md",
    before:
      "# Imported symbols\nKeep \uE000addition\uE001 and \uE002deletion\uE003 literal.\nStatus: draft",
    after:
      "# Imported symbols\nKeep \uE000addition\uE001 and \uE002deletion\uE003 literal.\nStatus: reviewed",
  },
};
