import type { Meta, StoryObj } from "@/lib/story";
import { PatternListEditor, type PatternListEditorProps } from "./PatternListEditor";

const meta = {
  title: "Settings/Pattern List Editor",
  component: PatternListEditor,
  args: {
    value: "",
    onChange: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<PatternListEditorProps>;
export default meta;

/** No patterns yet — the state a vault with an untouched Index scope shows. */
export const Empty: StoryObj<PatternListEditorProps> = {};

/** One badge per pattern kind, so the icon and colour of each stays checkable. */
export const AllPatternKinds: StoryObj<PatternListEditorProps> = {
  args: { value: "notes/private,#archive,[[Daily Note]],*.pdf" },
};

/** A path long enough to truncate inside its badge rather than widen the row. */
export const LongPatternTruncates: StoryObj<PatternListEditorProps> = {
  args: { value: "Archive/2024/Quarterly Reviews/Engineering/Retrospectives" },
};

/** Past the collapsed height the list fades out and offers "Show N items". */
export const OverflowsCollapsed: StoryObj<PatternListEditorProps> = {
  args: {
    value: [
      "copilot",
      "Archive",
      "Templates",
      "Attachments",
      "Journal/2023",
      "Journal/2024",
      "#draft",
      "#private",
      "*.pdf",
      "*.canvas",
      "[[Scratchpad]]",
      "[[Inbox]]",
    ].join(","),
  },
};
