import type { FC, SVGProps } from "react";
import AirtableLogo from "./logos/airtable.svg";
import AtlassianLogo from "./logos/atlassian.svg";
import BasecampLogo from "./logos/basecamp.svg";
import ClickUpLogo from "./logos/clickup.svg";
import CloudflareLogo from "./logos/cloudflare.svg";
import CodaLogo from "./logos/coda.svg";
import DropboxLogo from "./logos/dropbox.svg";
import EgnyteLogo from "./logos/egnyte.svg";
import IntercomLogo from "./logos/intercom.svg";
import LinearLogo from "./logos/linear.svg";
import MakeLogo from "./logos/make.svg";
import MiroLogo from "./logos/miro.svg";
import NeonLogo from "./logos/neon.svg";
import NetlifyLogo from "./logos/netlify.svg";
import NotionLogo from "./logos/notion.svg";
import PayPalLogo from "./logos/paypal.svg";
import PostHogLogo from "./logos/posthog.svg";
import SentryLogo from "./logos/sentry.svg";
import SquareLogo from "./logos/square.svg";
import StripeLogo from "./logos/stripe.svg";
import SupabaseLogo from "./logos/supabase.svg";
import TodoistLogo from "./logos/todoist.svg";
import VercelLogo from "./logos/vercel.svg";
import WebflowLogo from "./logos/webflow.svg";
import WixLogo from "./logos/wix.svg";
import ZapierLogo from "./logos/zapier.svg";

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
  readonly Logo?: FC<SVGProps<SVGSVGElement>>;
}

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = Object.freeze([
  {
    id: "airtable",
    name: "Airtable",
    description: "Bases, tables and records",
    category: "Tasks & projects",
    serverUrl: "https://mcp.airtable.com/mcp",
    Logo: AirtableLogo,
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
    Logo: AtlassianLogo,
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
    Logo: BasecampLogo,
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
    Logo: ClickUpLogo,
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Workers, DNS and account settings",
    category: "Developer",
    serverUrl: "https://mcp.cloudflare.com/mcp",
    Logo: CloudflareLogo,
  },
  {
    id: "coda",
    name: "Coda",
    description: "Docs and tables",
    category: "Notes & docs",
    serverUrl: "https://coda.io/apis/mcp",
    Logo: CodaLogo,
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Files and folders",
    category: "Notes & docs",
    serverUrl: "https://mcp.dropbox.com/mcp",
    Logo: DropboxLogo,
  },
  {
    id: "egnyte",
    name: "Egnyte",
    description: "Company files and folders",
    category: "Notes & docs",
    serverUrl: "https://mcp-server.egnyte.com/mcp",
    Logo: EgnyteLogo,
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
    Logo: IntercomLogo,
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
    Logo: LinearLogo,
  },
  {
    id: "make",
    name: "Make",
    description: "Scenarios and automations",
    category: "Automation",
    serverUrl: "https://mcp.make.com",
    Logo: MakeLogo,
  },
  {
    id: "miro",
    name: "Miro",
    description: "Boards and diagrams",
    category: "Design",
    serverUrl: "https://mcp.miro.com/",
    Logo: MiroLogo,
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
    Logo: NeonLogo,
  },
  {
    id: "netlify",
    name: "Netlify",
    description: "Sites and deploys",
    category: "Developer",
    serverUrl: "https://netlify-mcp.netlify.app/mcp",
    Logo: NetlifyLogo,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages and databases",
    category: "Notes & docs",
    serverUrl: "https://mcp.notion.com/mcp",
    Logo: NotionLogo,
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "Invoices, orders and payments",
    category: "Business",
    serverUrl: "https://mcp.paypal.com/http",
    Logo: PayPalLogo,
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
    Logo: PostHogLogo,
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
    Logo: SentryLogo,
  },
  {
    id: "square",
    name: "Square",
    description: "Payments, orders and catalog",
    category: "Business",
    serverUrl: "https://mcp.squareup.com/mcp",
    Logo: SquareLogo,
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, customers and invoices",
    category: "Business",
    serverUrl: "https://mcp.stripe.com",
    Logo: StripeLogo,
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Projects, databases and functions",
    category: "Developer",
    serverUrl: "https://mcp.supabase.com/mcp",
    Logo: SupabaseLogo,
  },
  {
    id: "todoist",
    name: "Todoist",
    description: "Tasks and projects",
    category: "Tasks & projects",
    serverUrl: "https://ai.todoist.net/mcp",
    Logo: TodoistLogo,
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Projects, deployments and logs",
    category: "Developer",
    serverUrl: "https://mcp.vercel.com",
    Logo: VercelLogo,
  },
  {
    id: "webflow",
    name: "Webflow",
    description: "Sites, pages and CMS content",
    category: "Design",
    serverUrl: "https://mcp.webflow.com/mcp",
    Logo: WebflowLogo,
  },
  {
    id: "wix",
    name: "Wix",
    description: "Sites, stores and bookings",
    category: "Design",
    serverUrl: "https://mcp.wix.com/mcp",
    Logo: WixLogo,
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Actions in thousands of apps",
    category: "Automation",
    serverUrl: "https://mcp.zapier.com/api/v1/connect",
    Logo: ZapierLogo,
  },
]);
