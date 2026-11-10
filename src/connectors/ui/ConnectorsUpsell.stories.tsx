import { ConnectorsUpsell, type ConnectorsUpsellProps } from "@/connectors/ui/ConnectorsUpsell";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Connectors/Supporter Upsell",
  component: ConnectorsUpsell,
  args: { onEnterLicenseKey: () => undefined, onSeePlans: () => undefined },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ConnectorsUpsellProps>;
export default meta;

export const NotASupporter: StoryObj<ConnectorsUpsellProps> = {};
