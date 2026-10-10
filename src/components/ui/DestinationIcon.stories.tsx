import { DestinationIcon } from "@/components/ui/DestinationIcon";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type DestinationIconProps = React.ComponentProps<typeof DestinationIcon>;

const meta = {
  title: "UI/Destination Icon",
  component: DestinationIcon,
  args: { destination: { kind: "cloud", label: "Anthropic" } },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<DestinationIconProps>;
export default meta;

export const Cloud: StoryObj<DestinationIconProps> = {};

export const Local: StoryObj<DestinationIconProps> = {
  args: { destination: { kind: "local", label: "A server on this computer" } },
};

export const CopilotPlusWithoutLicense: StoryObj<DestinationIconProps> = {
  args: {
    destination: { kind: "lock", label: "Brevilabs servers (US)" },
    note: "Copilot license required",
  },
};
