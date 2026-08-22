import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { remarkPublishedDocs } from "./src/remark-published-docs.mjs";

// Existing guide routes stay stable while section links make the most important
// workflows visible without splitting their source files.
const sidebar = [
  { label: "Start here", items: [{ slug: "" }, { slug: "getting-started" }] },
  {
    label: "Agent Chat",
    items: [
      { label: "Agent Chat overview", link: "/agent-mode-and-tools/" },
      { label: "Choose an agent", link: "/agent-mode-and-tools/#choose-an-agent" },
      {
        label: "Multi-agent answers",
        link: "/agent-mode-and-tools/#multi-agent-answers",
      },
      { label: "Skills across agents", link: "/agent-mode-and-tools/#skills-across-agents" },
      { slug: "projects" },
      { slug: "context-and-mentions" },
      { slug: "system-prompts" },
      { slug: "agents-md-examples" },
      { slug: "agent-mode-windows-setup" },
    ],
  },
  {
    label: "Everyday tools",
    items: [{ slug: "custom-commands" }, { slug: "chat-interface" }],
  },
  {
    label: "Models, plans, and Miyo",
    items: [
      { label: "Providers and BYOK", link: "/llm-providers/" },
      { label: "Model selection", link: "/models-and-parameters/" },
      { label: "Miyo and semantic search", link: "/vault-search-and-indexing/" },
      { label: "Copilot paid plans", link: "/copilot-plus-and-self-host/" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Settings overview", link: "/settings/" },
      { label: "Basic", link: "/settings/#basic" },
      { label: "BYOK", link: "/settings/#byok" },
      { label: "Miyo", link: "/settings/#miyo" },
      { label: "Skills", link: "/settings/#skills" },
      { label: "Command", link: "/settings/#command" },
      { label: "Self-Host", link: "/settings/#self-host" },
      { label: "Advanced", link: "/settings/#advanced" },
    ],
  },
  {
    label: "Help and reference",
    items: [{ slug: "troubleshooting-and-faq" }, { slug: "miyo-api" }],
  },
];

export default defineConfig({
  site: "https://docs.obsidiancopilot.com",
  markdown: { remarkPlugins: [remarkPublishedDocs] },
  integrations: [
    starlight({
      title: "Copilot for Obsidian",
      favicon: "/favicon.svg",
      logo: {
        dark: "./src/assets/copilot-mark-cream.svg",
        light: "./src/assets/copilot-icon-dark.svg",
        alt: "",
      },
      sidebar,
    }),
  ],
});
