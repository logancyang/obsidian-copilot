import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { headingTitledGlob } from "./docs-loader.mjs";

export const collections = {
  // Only the guides at the top of `docs/` are published; `docs/plans/` holds
  // internal planning notes and the folder also carries non-Markdown installers.
  docs: defineCollection({
    loader: headingTitledGlob({ base: "../docs", pattern: "*.md" }),
    schema: docsSchema(),
  }),
};
