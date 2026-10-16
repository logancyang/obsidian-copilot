"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertBundleSize,
  createBundleSizeGuard,
  dedupeEsbuildLegalComments,
  rewriteExactZodImports,
} = require("./bundleSizeGuard.js");

const LEGAL_PREFIX = "/*! Bundled license information:\n\n";
const LEGAL_SUFFIX = "*/\n";

function legalEntry(filePath, body) {
  return `${filePath}:\n${body}\n`;
}

function legalBundle(...entries) {
  return `runtime();\n${LEGAL_PREFIX}${entries.join("\n")}${LEGAL_SUFFIX}`;
}

describe("bundleSizeGuard", () => {
  describe("rewriteExactZodImports()", () => {
    it("rewrites exact z-only imports from zod and zod/v4 for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      expect(
        rewriteExactZodImports(
          [
            'import { z } from "zod";',
            "import { z as schema } from 'zod/v4';",
            "schema.string();",
          ].join("\n"),
          "dependency.js"
        )
      ).toBe(
        ['import * as z from "zod";', "import * as schema from 'zod/v4';", "schema.string();"].join(
          "\n"
        )
      );
    });

    it("leaves type-only, multi-symbol, namespace, unrelated, attributed, and string imports unchanged for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      const source = [
        'import type { z } from "zod";',
        'import zodDefault, { z } from "zod";',
        'import { z, ZodError } from "zod";',
        'import * as z from "zod";',
        'import { z } from "other";',
        'import { z } from "zod" with { type: "json" };',
        '// import { z } from "zod";',
        'const example = `import { z } from "zod";`;',
      ].join("\n");

      expect(rewriteExactZodImports(source, "dependency.ts")).toBe(source);
    });

    it("preserves comments inside exact imports for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      const source = [
        'import /*! Zod license */ { z } from "zod";',
        "import { /*! Required notice */ z as schema } from 'zod/v4';",
      ].join("\n");

      expect(rewriteExactZodImports(source, "dependency.js")).toBe(source);
    });
  });

  describe("createBundleSizeGuard()", () => {
    const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/94";
    let workDir;

    beforeEach(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-size-guard "));
    });

    afterEach(() => {
      fs.rmSync(workDir, { force: true, recursive: true });
    });

    function setupGuard(production, outfile) {
      const hooks = {};
      createBundleSizeGuard({ production }).setup({
        initialOptions: { outfile },
        onEnd: (callback) => {
          hooks.onEnd = callback;
        },
        onLoad: (_options, callback) => {
          hooks.onLoad = callback;
        },
      });
      return hooks;
    }

    it(`rewrites an exact zod import when loading a dependency for ${ISSUE}`, async () => {
      const dependency = path.join(workDir, "dependency.ts");
      fs.writeFileSync(dependency, 'import { z } from "zod";\nz.string();\n');

      const result = await setupGuard(false).onLoad({ path: dependency });

      expect(result).toEqual({
        contents: 'import * as z from "zod";\nz.string();\n',
        loader: "ts",
        resolveDir: workDir,
      });
    });

    it(`leaves a dependency without exact zod imports to esbuild's default loading for ${ISSUE}`, async () => {
      const dependency = path.join(workDir, "dependency.js");
      fs.writeFileSync(dependency, "module.exports = 1;\n");

      await expect(setupGuard(false).onLoad({ path: dependency })).resolves.toBeUndefined();
    });

    it(`does not enforce artifact limits in development for ${ISSUE}`, () => {
      expect(setupGuard(false).onEnd).toBeUndefined();
    });

    it(`dedupes legal comments in the production outfile for ${ISSUE}`, () => {
      const outfile = path.join(workDir, "main.js");
      const notice = "  (*! notice *)";
      fs.writeFileSync(
        outfile,
        legalBundle(legalEntry("a.js", notice), legalEntry("b.js", notice))
      );

      setupGuard(true, outfile).onEnd({ errors: [] });

      expect(fs.readFileSync(outfile, "utf8")).toBe(
        legalBundle(legalEntry("a.js (+1 identical notices)", notice))
      );
    });

    it(`fails the production build when the outfile reaches the size ceiling for ${ISSUE}`, () => {
      const outfile = path.join(workDir, "main.js");
      fs.writeFileSync(
        outfile,
        `${"a".repeat(5_000_000)}\n${legalBundle(legalEntry("a.js", "  (*! notice *)"))}`
      );

      expect(() => setupGuard(true, outfile).onEnd({ errors: [] })).toThrow(
        "strictly below 5000000 bytes"
      );
    });

    it(`leaves the outfile untouched when esbuild already reported errors for ${ISSUE}`, () => {
      const outfile = path.join(workDir, "main.js");
      fs.writeFileSync(outfile, "partial output");

      setupGuard(true, outfile).onEnd({ errors: [{ text: "failed" }] });

      expect(fs.readFileSync(outfile, "utf8")).toBe("partial output");
    });
  });

  describe("dedupeEsbuildLegalComments()", () => {
    it("keeps first-seen order and every unique notice body byte-for-byte while counting identical notices for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      const alpha = "  (*!\n   * License α  \n   *)";
      const beta = "  (** @license β *)";
      const source = legalBundle(
        legalEntry("first-alpha.js", alpha),
        legalEntry("only-beta.js", beta),
        legalEntry("second-alpha.js", alpha)
      );

      expect(dedupeEsbuildLegalComments(source)).toBe(
        legalBundle(
          legalEntry("first-alpha.js (+1 identical notices)", alpha),
          legalEntry("only-beta.js", beta)
        )
      );
    });

    it.each([
      ["missing", "runtime();\n"],
      ["malformed header", `runtime();\n/*! Bundled license information:\n${LEGAL_SUFFIX}`],
      ["malformed footer", `runtime();\n${LEGAL_PREFIX}${legalEntry("a.js", "  (*! notice *)")}*/`],
      [
        "multiple",
        `${legalBundle(legalEntry("a.js", "  (*! notice *)"))}${legalBundle(
          legalEntry("b.js", "  (*! other *)")
        )}`,
      ],
      ["non-EOF", `${legalBundle(legalEntry("a.js", "  (*! notice *)"))}runtime();\n`],
      ["incomplete entry", `runtime();\n${LEGAL_PREFIX}a.js:\n  (*! notice *\n${LEGAL_SUFFIX}`],
    ])(
      "fails closed on a %s legal block for https://github.com/Brevilabs/obsidian-copilot-private/issues/94",
      (_caseName, source) => {
        expect(() => dedupeEsbuildLegalComments(source)).toThrow("[bundle-size-guard]");
      }
    );
  });

  describe("assertBundleSize()", () => {
    it("uses the 5 MB ceiling for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      expect(assertBundleSize("a".repeat(4_999_999))).toBe(4_999_999);
      expect(() => assertBundleSize("a".repeat(5_000_000))).toThrow("strictly below 5000000 bytes");
    });

    it("measures UTF-8 bytes and enforces a strict boundary for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      expect(assertBundleSize("é", 3)).toBe(2);
      expect(() => assertBundleSize("é", 2)).toThrow("strictly below 2 bytes");
    });
  });
});
