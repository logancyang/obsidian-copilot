import type {
  CustomConnectorParse,
  ParsedCustomConnector,
} from "@/connectors/custom/customConnectorConfig";
import {
  CustomConnectorForm,
  type CustomConnectorFormProps,
} from "@/connectors/ui/CustomConnectorModal";
import type { Meta, StoryObj } from "@/lib/story";

const ADD_HELPER =
  "Paste the MCP server config from its README. Values in env and headers stay in this device's keychain.";

const LOCAL_AND_REMOTE_TEXT = JSON.stringify(
  {
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_xxxxxxxxxxxx" },
      },
      "Acme Docs": {
        url: "https://mcp.acme.example/mcp",
        headers: { Authorization: "Bearer acme-key", "X-Team": "docs" },
      },
    },
  },
  null,
  2
);

const GITHUB: ParsedCustomConnector = {
  config: {
    id: "github",
    name: "github",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envNames: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
  secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_xxxxxxxxxxxx" },
};

const LOCAL_AND_REMOTE: CustomConnectorParse = {
  ok: true,
  connectors: [
    GITHUB,
    {
      config: {
        id: "acmedocs",
        name: "Acme Docs",
        url: "https://mcp.acme.example/mcp",
        headerNames: ["Authorization", "X-Team"],
      },
      secrets: { Authorization: "Bearer acme-key", "X-Team": "docs" },
    },
  ],
};

const EDIT_TEXT = JSON.stringify(
  {
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
      },
    },
  },
  null,
  2
);

const meta = {
  title: "Connectors/Custom Connector Dialog",
  component: CustomConnectorForm,
  args: {
    helper: ADD_HELPER,
    submitLabel: "Add",
    parse: () => LOCAL_AND_REMOTE,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CustomConnectorFormProps>;
export default meta;

export const Empty: StoryObj<CustomConnectorFormProps> = {};

export const LocalAndRemotePreview: StoryObj<CustomConnectorFormProps> = {
  args: { initialText: LOCAL_AND_REMOTE_TEXT },
};

export const InvalidJson: StoryObj<CustomConnectorFormProps> = {
  args: {
    initialText: '{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n',
    parse: () => ({ ok: false, error: "This isn't valid JSON." }),
  },
};

const GITHUB_BLANK: ParsedCustomConnector = {
  config: GITHUB.config,
  secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
};

export const EditWithBlankValues: StoryObj<CustomConnectorFormProps> = {
  args: {
    helper: "Leave a value blank to keep the one stored on this device.",
    submitLabel: "Save",
    initialText: EDIT_TEXT,
    storedValueNames: new Set(["GITHUB_PERSONAL_ACCESS_TOKEN"]),
    parse: () => ({ ok: true, connectors: [GITHUB_BLANK] }),
  },
};

export const EditWithValueMissingOnThisDevice: StoryObj<CustomConnectorFormProps> = {
  args: {
    helper: "Leave a value blank to keep the one stored on this device.",
    submitLabel: "Save",
    initialText: EDIT_TEXT,
    parse: () => ({ ok: true, connectors: [GITHUB_BLANK] }),
  },
};
