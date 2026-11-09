import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import { ConnectorLogo, type ConnectorLogoProps } from "@/connectors/ui/ConnectorLogo";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const LOGO_BASE_URL = "https://images.brevilabs.com/newsletters/copilot-plugin/connectors";

function service(name: string, logoFile?: string): ConnectorCatalogEntry {
  return {
    id: name.toLowerCase(),
    name,
    description: `${name} connector`,
    category: "Developer",
    serverUrl: `https://mcp.${name.toLowerCase()}.com/mcp`,
    logoUrl: logoFile && `${LOGO_BASE_URL}/${logoFile}`,
  };
}

const NOTION = service("Notion", "notion.png");
const MIXED_MARKS = [
  NOTION,
  service("Vercel", "vercel.png"),
  service("Linear", "linear.png"),
  service("Todoist", "todoist.png"),
  service("Zapier", "zapier.png"),
  service("Granola"),
];

const meta = {
  title: "Connectors/Connector Logo",
  component: ConnectorLogo,
  args: { service: NOTION },
  parameters: { gallery: { host: "leaf", layout: "centered" } },
} satisfies Meta<ConnectorLogoProps>;
export default meta;

export const Logo: StoryObj<ConnectorLogoProps> = {};

export const BrokenLogoUrl: StoryObj<ConnectorLogoProps> = {
  args: { service: { ...NOTION, logoUrl: `${LOGO_BASE_URL}/missing.png` } },
};

export const NoLogo: StoryObj<ConnectorLogoProps> = {
  args: { service: { ...NOTION, logoUrl: undefined } },
};

export const DarkAndColorMarks: StoryObj<ConnectorLogoProps> = {
  render: () => (
    <div className="tw-flex tw-gap-3">
      {MIXED_MARKS.map((entry) => (
        <ConnectorLogo key={entry.id} service={entry} />
      ))}
    </div>
  ),
};
