import type { Meta, StoryObj } from "@/lib/story";
import { PairingConfirmContent, type PairingConfirmContentProps } from "./PairingConfirmContent";

const meta = {
  title: "Modals/Pairing Confirmation",
  component: PairingConfirmContent,
  args: {
    details: {
      desktopName: "Studio Mac",
      address: "100.64.0.7:52341",
      linkVaultName: "Work notes",
      openVaultName: "Work notes",
    },
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<PairingConfirmContentProps>;
export default meta;

export const SameVault: StoryObj<PairingConfirmContentProps> = {};

export const LinkNamesAnotherVault: StoryObj<PairingConfirmContentProps> = {
  args: {
    details: {
      desktopName: "Studio Mac",
      address: "100.64.0.7:52341",
      linkVaultName: "Personal journal",
      openVaultName: "Work notes",
    },
  },
};

export const UnnamedDesktopWithLongNames: StoryObj<PairingConfirmContentProps> = {
  args: {
    details: {
      desktopName: "",
      address: "100.127.255.254:65535",
      linkVaultName: "A vault whose name is long enough to need wrapping inside the dialog",
      openVaultName: "Another vault whose name is long enough to need wrapping inside the dialog",
    },
  },
};
