import type { Meta, StoryObj } from "@/lib/story";
import {
  MiyoDocumentProcessingRow,
  type MiyoDocumentProcessingRowProps,
} from "./MiyoDocumentProcessingRow";

const meta = {
  title: "Settings/Miyo Document Processing Row",
  component: MiyoDocumentProcessingRow,
  args: { enabled: true, onEnabledChange: () => {} },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<MiyoDocumentProcessingRowProps>;
export default meta;

export const On: StoryObj<MiyoDocumentProcessingRowProps> = {};

export const Off: StoryObj<MiyoDocumentProcessingRowProps> = {
  args: { enabled: false },
};
