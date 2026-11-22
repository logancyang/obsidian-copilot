import type { ServiceToolInfo } from "@/connectors/connectorTools";

export const NOTION_TOOLS: readonly ServiceToolInfo[] = [
  {
    name: "notion-search",
    title: "Search Notion and connected sources",
    description:
      "Search your Notion workspace and the sources connected to it, such as Slack, Google Drive and GitHub, by keyword or meaning.\n\n## Usage\n- Set `query_type` to `internal` for workspace search.\n- **Never** pass a page URL here.",
    annotations: { readOnlyHint: true },
  },
  {
    name: "notion-fetch",
    description: "Retrieves a Notion page or database by its URL or ID.",
    annotations: { title: "Fetch a page or database", readOnlyHint: true },
  },
  {
    name: "notion-get-users",
    description: "Lists the people in the workspace.",
    annotations: { readOnlyHint: true },
  },
  {
    name: "notion-get-comments",
    description: "Gets every comment on a page.",
    annotations: { readOnlyHint: true },
  },
  { name: "notion-get-teams", annotations: { readOnlyHint: true } },
  {
    name: "notion-create-pages",
    description:
      "Creates one or more Notion pages with the properties and content you give it. Pages can go under another page, in a database, or at the top of the workspace when no parent is given, and their content is written in Notion-flavored Markdown.",
    annotations: { readOnlyHint: false },
  },
  {
    name: "notion-update-page",
    description: "Changes a page's properties or content.",
    annotations: { readOnlyHint: false },
  },
  { name: "notion-move-pages", description: "Moves pages or databases to a new parent." },
  { name: "notion-duplicate-page", description: "Duplicates a page in the background." },
  { name: "notion-create-database", description: "Creates a database with the given columns." },
  { name: "notion-update-database", description: "Changes a database's title or columns." },
  { name: "notion-create-comment", description: "Adds a comment to a page." },
];

export const FAKE_CUSTOM_TOOLS: readonly ServiceToolInfo[] = [
  { name: "echo", description: "Echo the text back.", annotations: { readOnlyHint: true } },
  { name: "remember", description: "Remember a piece of text." },
];
