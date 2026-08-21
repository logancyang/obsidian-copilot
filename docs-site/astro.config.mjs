import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { remarkPublishedDocs } from "./src/remark-published-docs.mjs";

// Slugs match the source filenames, so every guide keeps the path it had on the
// previous site minus its `/docs` prefix. Labels are omitted so each entry shows
// the title the loader derived from the guide's own heading.
const sidebar = [
  { label: "Start here", items: [{ slug: "" }, { slug: "getting-started" }] },
  {
    label: "Quick Chat",
    items: [
      { slug: "chat-interface" },
      { slug: "models-and-parameters" },
      { slug: "llm-providers" },
      { slug: "context-and-mentions" },
      { slug: "custom-commands" },
      { slug: "vault-search-and-indexing" },
      { slug: "projects" },
      { slug: "system-prompts" },
    ],
  },
  {
    label: "Agent Mode",
    items: [{ slug: "agent-mode-and-tools" }, { slug: "agent-mode-windows-setup" }],
  },
  { label: "Paid plans", items: [{ slug: "copilot-plus-and-self-host" }] },
  {
    label: "Help and reference",
    items: [
      { slug: "troubleshooting-and-faq" },
      { slug: "miyo-api" },
      { slug: "agents-md-examples" },
    ],
  },
];

export default defineConfig({
  site: "https://docs.obsidiancopilot.com",
  markdown: { remarkPlugins: [remarkPublishedDocs] },
  integrations: [starlight({ title: "Copilot for Obsidian", sidebar })],
});
