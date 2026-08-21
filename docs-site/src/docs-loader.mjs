import { readFile } from "node:fs/promises";
import { glob } from "astro/loaders";

/** The level-one heading that opens every guide in `docs/`. */
const LEADING_HEADING = /^#\s+(.+?)\s*$/m;

/**
 * Loads guides that carry no frontmatter by taking each file's opening
 * level-one heading as the title Starlight requires. `docs/` is the canonical
 * source of these guides and is published unmodified, so the title cannot come
 * from frontmatter the way Starlight expects. `remarkPublishedDocs` drops the
 * heading from the body so the page does not repeat it under its own title.
 *
 * @param options Forwarded to Astro's `glob()` loader, which selects the files.
 */
export function headingTitledGlob(options) {
  const loader = glob(options);
  return {
    ...loader,
    load: (context) =>
      loader.load({
        ...context,
        parseData: async ({ data, filePath, ...rest }) => {
          const heading = LEADING_HEADING.exec(await readFile(filePath, "utf8"))?.[1];
          // Titles are rendered as plain text, so inline-code markers in a
          // heading would otherwise show up as literal backticks.
          const title = heading?.replaceAll("`", "");
          return context.parseData({ ...rest, filePath, data: { title, ...data } });
        },
      }),
  };
}
