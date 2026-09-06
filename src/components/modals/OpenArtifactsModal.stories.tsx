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
    openPreview: async () => true,
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

/** Confirmation shown when a note has no existing public identity. */
export const Publish: StoryObj<OpenArtifactsModalContentProps> = {};

/** Management state for a note that already has an OpenArtifacts page. */
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

/** Host-owned review of the exact HTML bytes prepared by an agent. */
export const AgentReview: StoryObj<OpenArtifactsModalContentProps> = {
  args: {
    review: {
      sourcePath: "Notes/Architecture.md",
      digest: "f3a2d869506a454b2f43ca76b82a7d2fb4a94825a1ef9290299e2960ab0c5c11",
      payload: {
        title: "Architecture",
        html: "<!doctype html><html><body>Architecture</body></html>",
        byteLength: 56,
      },
      previewPath: "/tmp/openartifacts-preview.html",
      previewUrl: "file:///tmp/openartifacts-preview.html",
    },
    onRegenerate: () => undefined,
  },
};

/** Failed browser opening leaves approval disabled and offers the same preview link. */
export const PreviewFailed: StoryObj<OpenArtifactsModalContentProps> = {
  args: { ...AgentReview.args, openPreview: async () => false },
};
