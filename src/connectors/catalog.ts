export type ConnectorCategory =
  | "Notes & docs"
  | "Tasks & projects"
  | "Meetings"
  | "Design"
  | "Developer"
  | "Business"
  | "Automation";

export const CONNECTOR_CATEGORIES: readonly ConnectorCategory[] = Object.freeze([
  "Notes & docs",
  "Tasks & projects",
  "Meetings",
  "Design",
  "Developer",
  "Business",
  "Automation",
]);

export interface ConnectorCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ConnectorCategory;
  readonly serverUrl: string;
  readonly logoUrl?: string;
}

const LOGO_BASE_URL = "https://images.brevilabs.com/newsletters/copilot-plugin/connectors";

const CATALOG_ENTRIES: readonly Omit<ConnectorCatalogEntry, "logoUrl">[] = [
  {
    id: "airtable",
    name: "Airtable",
    description: "Bases, tables and records",
    category: "Tasks & projects",
    serverUrl: "https://mcp.airtable.com/mcp",
  },
  {
    id: "apify",
    name: "Apify",
    description: "Web scrapers and their results",
    category: "Automation",
    serverUrl: "https://mcp.apify.com",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Jira issues and Confluence pages",
    category: "Tasks & projects",
    serverUrl: "https://mcp.atlassian.com/v2/mcp",
  },
  {
    id: "attio",
    name: "Attio",
    description: "CRM records and lists",
    category: "Business",
    serverUrl: "https://mcp.attio.com/mcp",
  },
  {
    id: "basecamp",
    name: "Basecamp",
    description: "Projects, to-dos and messages",
    category: "Tasks & projects",
    serverUrl: "https://mcp.basecamp.com/mcp",
  },
  {
    id: "canva",
    name: "Canva",
    description: "Designs and brand assets",
    category: "Design",
    serverUrl: "https://mcp.canva.com/mcp",
  },
  {
    id: "clickup",
    name: "ClickUp",
    description: "Tasks, docs and goals",
    category: "Tasks & projects",
    serverUrl: "https://mcp.clickup.com/mcp",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Workers, DNS and account settings",
    category: "Developer",
    serverUrl: "https://mcp.cloudflare.com/mcp",
  },
  {
    id: "coda",
    name: "Coda",
    description: "Docs and tables",
    category: "Notes & docs",
    serverUrl: "https://coda.io/apis/mcp",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Files and folders",
    category: "Notes & docs",
    serverUrl: "https://mcp.dropbox.com/mcp",
  },
  {
    id: "egnyte",
    name: "Egnyte",
    description: "Company files and folders",
    category: "Notes & docs",
    serverUrl: "https://mcp-server.egnyte.com/mcp",
  },
  {
    id: "fireflies",
    name: "Fireflies",
    description: "Meeting transcripts and summaries",
    category: "Meetings",
    serverUrl: "https://api.fireflies.ai/mcp",
  },
  {
    id: "granola",
    name: "Granola",
    description: "Meeting notes",
    category: "Meetings",
    serverUrl: "https://mcp.granola.ai/mcp",
  },
  {
    id: "intercom",
    name: "Intercom",
    description: "Conversations and contacts",
    category: "Business",
    serverUrl: "https://mcp.intercom.com/mcp",
  },
  {
    id: "jam",
    name: "Jam",
    description: "Bug reports and recordings",
    category: "Developer",
    serverUrl: "https://mcp.jam.dev/mcp",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects and cycles",
    category: "Tasks & projects",
    serverUrl: "https://mcp.linear.app/mcp",
  },
  {
    id: "make",
    name: "Make",
    description: "Scenarios and automations",
    category: "Automation",
    serverUrl: "https://mcp.make.com",
  },
  {
    id: "miro",
    name: "Miro",
    description: "Boards and diagrams",
    category: "Design",
    serverUrl: "https://mcp.miro.com/",
  },
  {
    id: "monday",
    name: "monday.com",
    description: "Boards, items and updates",
    category: "Tasks & projects",
    serverUrl: "https://mcp.monday.com/mcp",
  },
  {
    id: "neon",
    name: "Neon",
    description: "Postgres projects and databases",
    category: "Developer",
    serverUrl: "https://mcp.neon.tech/mcp",
  },
  {
    id: "netlify",
    name: "Netlify",
    description: "Sites and deploys",
    category: "Developer",
    serverUrl: "https://netlify-mcp.netlify.app/mcp",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages and databases",
    category: "Notes & docs",
    serverUrl: "https://mcp.notion.com/mcp",
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "Invoices, orders and payments",
    category: "Business",
    serverUrl: "https://mcp.paypal.com/mcp",
  },
  {
    id: "plaid",
    name: "Plaid",
    description: "Item debugging and Link analytics",
    category: "Business",
    serverUrl: "https://api.dashboard.plaid.com/mcp/",
  },
  {
    id: "posthog",
    name: "PostHog",
    description: "Product analytics and feature flags",
    category: "Developer",
    serverUrl: "https://mcp.posthog.com/mcp",
  },
  {
    id: "raindrop",
    name: "Raindrop",
    description: "Bookmarks and collections",
    category: "Notes & docs",
    serverUrl: "https://api.raindrop.io/rest/v2/ai/mcp",
  },
  {
    id: "readwise",
    name: "Readwise",
    description: "Highlights and saved articles",
    category: "Notes & docs",
    serverUrl: "https://mcp2.readwise.io/mcp",
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Errors and issues",
    category: "Developer",
    serverUrl: "https://mcp.sentry.dev/mcp",
  },
  {
    id: "square",
    name: "Square",
    description: "Payments, orders and catalog",
    category: "Business",
    serverUrl: "https://mcp.squareup.com/mcp",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, customers and invoices",
    category: "Business",
    serverUrl: "https://mcp.stripe.com",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Projects, databases and functions",
    category: "Developer",
    serverUrl: "https://mcp.supabase.com/mcp",
  },
  {
    id: "todoist",
    name: "Todoist",
    description: "Tasks and projects",
    category: "Tasks & projects",
    serverUrl: "https://ai.todoist.net/mcp",
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Projects, deployments and logs",
    category: "Developer",
    serverUrl: "https://mcp.vercel.com",
  },
  {
    id: "webflow",
    name: "Webflow",
    description: "Sites, pages and CMS content",
    category: "Design",
    serverUrl: "https://mcp.webflow.com/mcp",
  },
  {
    id: "wix",
    name: "Wix",
    description: "Sites, stores and bookings",
    category: "Design",
    serverUrl: "https://mcp.wix.com/mcp",
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Actions in thousands of apps",
    category: "Automation",
    serverUrl: "https://mcp.zapier.com/api/v1/connect",
  },
];

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = Object.freeze(
  CATALOG_ENTRIES.map((entry) => ({ ...entry, logoUrl: `${LOGO_BASE_URL}/${entry.id}.png` }))
);

export const CONNECTOR_SERVICES: ReadonlyMap<string, ConnectorCatalogEntry> = new Map(
  CONNECTOR_CATALOG.map((service) => [service.id, service])
);
