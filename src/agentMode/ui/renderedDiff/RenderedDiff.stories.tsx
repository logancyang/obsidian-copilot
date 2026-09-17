import {
  ADDED_LIST_ITEM,
  BLOCK_MOVED,
  CJK_EDIT,
  CODE_BLOCK_LINE_CHANGE,
  FILE_CREATED,
  FILE_EMPTIED,
  FRONTMATTER_TAG_ADDED,
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

/** Every block kind in one document, which is how a real note diff reads. */
export const WholeNote: StoryObj<RenderedDiffProps> = story(WHOLE_NOTE);

/** A sentence rewritten in place. */
export const WordingChange: StoryObj<RenderedDiffProps> = story(WORDING_CHANGE);

/** A section demoted a level: both headings render, the old one struck through. */
export const HeadingLevelChange: StoryObj<RenderedDiffProps> = story(HEADING_LEVEL_CHANGE);

/** A bullet appended to a list. */
export const AddedListItem: StoryObj<RenderedDiffProps> = story(ADDED_LIST_ITEM);

/** A bullet dropped from the middle of a list, kept in place so the gap is visible. */
export const RemovedListItem: StoryObj<RenderedDiffProps> = story(REMOVED_LIST_ITEM);

/** A task ticked off, shown as the old line removed and the new line added. */
export const TaskCheckboxToggled: StoryObj<RenderedDiffProps> = story(TASK_CHECKBOX_TOGGLED);

/** Same link text, different destination. */
export const LinkHrefChange: StoryObj<RenderedDiffProps> = story(LINK_HREF_CHANGE);

/** A wikilink repointed at a renamed note. */
export const WikilinkRename: StoryObj<RenderedDiffProps> = story(WIKILINK_RENAME);

/** One corrected cell inside an otherwise untouched table. */
export const TableCellEdit: StoryObj<RenderedDiffProps> = story(TABLE_CELL_EDIT);

/** A whole row appended to a table. */
export const TableRowAdded: StoryObj<RenderedDiffProps> = story(TABLE_ROW_ADDED);

/** A whole row removed, kept in the table so the columns still line up. */
export const TableRowRemoved: StoryObj<RenderedDiffProps> = story(TABLE_ROW_REMOVED);

/** A fenced code block, diffed line by line without syntax highlighting. */
export const CodeBlockLineChange: StoryObj<RenderedDiffProps> = story(CODE_BLOCK_LINE_CHANGE);

/** A tag added to the frontmatter, which never reaches the Markdown renderer. */
export const FrontmatterTagAdded: StoryObj<RenderedDiffProps> = story(FRONTMATTER_TAG_ADDED);

/** A paragraph relocated verbatim. */
export const BlockMoved: StoryObj<RenderedDiffProps> = story(BLOCK_MOVED);

/** Chinese prose, which diffs per character. */
export const CjkEdit: StoryObj<RenderedDiffProps> = story(CJK_EDIT);

/** A note the agent created, so every block is an insertion. */
export const FileCreated: StoryObj<RenderedDiffProps> = story(FILE_CREATED);

/** A note the agent emptied, so every block is a deletion. */
export const FileEmptied: StoryObj<RenderedDiffProps> = story(FILE_EMPTIED);

/** A canvas file, shown verbatim rather than rendered. */
export const NonMarkdownFile: StoryObj<RenderedDiffProps> = story(NON_MARKDOWN_FILE);
