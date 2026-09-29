"use strict";

const {
  assertBundleSize,
  createBundleSizeGuard,
  dedupeEsbuildLegalComments,
  finalizeProductionBundle,
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
    it("registers only dependency rewriting in development for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      const build = { onEnd: jest.fn(), onLoad: jest.fn() };

      createBundleSizeGuard({ production: false }).setup(build);

      expect(build.onLoad).toHaveBeenCalledTimes(1);
      expect(build.onEnd).not.toHaveBeenCalled();
    });

    it("registers dependency rewriting and artifact enforcement in production for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      const build = { onEnd: jest.fn(), onLoad: jest.fn() };

      createBundleSizeGuard({ production: true }).setup(build);

      expect(build.onLoad).toHaveBeenCalledTimes(1);
      expect(build.onEnd).toHaveBeenCalledTimes(1);
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

  describe("finalizeProductionBundle()", () => {
    it("minifies representative code and preserves the deduplicated legal block for https://github.com/Brevilabs/obsidian-copilot-private/issues/325", async () => {
      const notice = "  (** @license Example 1.0 *)";
      const source = legalBundle(
        legalEntry("first.js", notice),
        legalEntry("second.js", notice)
      ).replace(
        "runtime();",
        "function add(firstNumber, secondNumber) { return firstNumber + secondNumber; } add(1, 2);"
      );

      const output = await finalizeProductionBundle(source);

      expect(Buffer.byteLength(output, "utf8")).toBeLessThan(Buffer.byteLength(source, "utf8"));
      expect(output).toContain("/*! Bundled license information:");
      expect(output).toContain("first.js (+1 identical notices)");
      expect(output).toContain("@license Example 1.0");
    });

    it("removes unused top-level declarations to preserve localization headroom for https://github.com/Brevilabs/obsidian-copilot-private/issues/325", async () => {
      const source = legalBundle(legalEntry("example.js", "  (** @license Example 1.0 *)")).replace(
        "runtime();",
        "const unusedLocalizationHeadroom = 'unused'; globalThis.keptValue = 'kept';"
      );

      const output = await finalizeProductionBundle(source);

      expect(output).not.toContain("unusedLocalizationHeadroom");
      expect(output).not.toContain("unused");
      expect(output).toContain("kept");
    });

    it("enforces the strict size limit on the minified artifact for https://github.com/Brevilabs/obsidian-copilot-private/issues/325", async () => {
      const source = legalBundle(legalEntry("example.js", "  (** @license Example 1.0 *)")).replace(
        "runtime();",
        "function identity(longArgumentName) { return longArgumentName; } identity(1);"
      );
      const finalized = await finalizeProductionBundle(source);
      const finalizedBytes = Buffer.byteLength(finalized, "utf8");

      expect(Buffer.byteLength(source, "utf8")).toBeGreaterThan(finalizedBytes + 1);
      await expect(finalizeProductionBundle(source, finalizedBytes + 1)).resolves.toBe(finalized);
      await expect(finalizeProductionBundle(source, finalizedBytes)).rejects.toThrow(
        `strictly below ${finalizedBytes} bytes`
      );
    });
  });
});
