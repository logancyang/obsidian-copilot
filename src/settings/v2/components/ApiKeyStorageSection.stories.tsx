import type { Meta, StoryObj } from "@/lib/story";
import { ApiKeyStorageSection, type ApiKeyStorageSectionProps } from "./ApiKeyStorageSection";

const meta = {
  title: "Settings/API Key Storage Section",
  component: ApiKeyStorageSection,
  args: {
    status: "stored",
    forgetting: false,
    onForgetAll: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ApiKeyStorageSectionProps>;
export default meta;

export const KeysStored: StoryObj<ApiKeyStorageSectionProps> = {};

export const NoKeysOnThisDevice: StoryObj<ApiKeyStorageSectionProps> = {
  args: { status: "empty" },
};

export const KeychainUnavailable: StoryObj<ApiKeyStorageSectionProps> = {
  args: { status: "unavailable" },
};

export const RemovingKeys: StoryObj<ApiKeyStorageSectionProps> = {
  args: { forgetting: true },
};
