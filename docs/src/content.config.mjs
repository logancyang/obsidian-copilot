import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { headingTitledGlob } from "./docs-loader.mjs";

export const collections = {
  // Only the guides next to this package are published. README documents the
  // package itself, `plans/` holds internal notes, and installers are not Markdown.
  docs: defineCollection({
    loader: headingTitledGlob({ base: ".", pattern: ["*.md", "!README.md"] }),
    schema: docsSchema(),
  }),
};
