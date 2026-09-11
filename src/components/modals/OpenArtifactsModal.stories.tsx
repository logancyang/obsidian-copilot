import type { Meta, StoryObj } from "@/lib/story";
import {
  OpenArtifactsModalContent,
  type OpenArtifactsModalContentProps,
} from "./OpenArtifactsModal";

const meta = {
  title: "Modals/OpenArtifacts",
  component: OpenArtifactsModalContent,
  args: {
    fileName: "Architecture",
    docId: null,
    onClose: () => undefined,
    onConfirm: async (action) => ({
      kind: "failure",
      action,
      message: "Preview interaction only.",
      accessNotice: false,
      retryable: false,
    }),
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<OpenArtifactsModalContentProps>;
export default meta;

/** Publish page names the action; the public-link audience stays visible before confirmation. */
export const Publish: StoryObj<OpenArtifactsModalContentProps> = {};

/** Update and unpublish name the public page; withdrawal opens a separate destructive confirmation. */
export const Manage: StoryObj<OpenArtifactsModalContentProps> = {
  args: { docId: "9f2k4mvq7t0xbz3n" },
};

/** Completion state that confirms the remote OpenArtifacts copy was withdrawn. */
export const Removed: StoryObj<OpenArtifactsModalContentProps> = {
  args: {
    docId: "9f2k4mvq7t0xbz3n",
    initialResult: { kind: "success", action: "delete" },
  },
};
