import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

export const companionEntries = {
  grok: "grok.ts",
  antigravity: "antigravity-main.ts",
  muse: "muse/main.mts",
};
export function companionAdaptersPlugin() {
  return {
    name: "companion-adapters",
    setup(builder) {
      builder.onEnd(async (result) => {
        if (result.errors.length) return;
        const license = await readFile("adapters/companions/AYC-LICENSE", "utf8");
        for (const [id, entry] of Object.entries(companionEntries)) {
          await build({
            entryPoints: [`adapters/companions/${entry}`],
            outfile: `companion-${id}.cjs`,
            bundle: true,
            platform: "node",
            format: "cjs",
            target: "node20",
            minify: true,
            legalComments: "eof",
            banner: { js: `/*! ${license} */` },
          });
        }
        await writeFile("COMPANION-LICENSE", license);
        await writeFile("MUSE-SDK-LICENSE", await readFile("node_modules/@muse-code/sdk/LICENSE"));
        await writeFile(
          "COMPANION-PROVENANCE.md",
          await readFile("adapters/companions/PROVENANCE.md")
        );
      });
    },
  };
}
