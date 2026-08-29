"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const MAX_BUNDLE_BYTES = 5_000_000;
const LEGAL_BLOCK_LABEL = "/*! Bundled license information:";
const LEGAL_BLOCK_PREFIX = `${LEGAL_BLOCK_LABEL}\n\n`;
const LEGAL_BLOCK_SUFFIX = "*/\n";
const DEPENDENCY_SOURCE = /(?:^|[/\\])node_modules[/\\].*\.(?:[cm]?[jt]sx?)$/;
const LOADERS = { ".cts": "ts", ".jsx": "jsx", ".mts": "ts", ".ts": "ts", ".tsx": "tsx" };

function rewriteExactZodImports(source, filePath = "source.js") {
  if (!source.includes("zod")) return source;

  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false);
  let output = source;

  for (let index = sourceFile.statements.length - 1; index >= 0; index--) {
    const statement = sourceFile.statements[index];
    if (!ts.isImportDeclaration(statement)) continue;

    // Only a z-only named import has the namespace-equivalent shape that caused the locale
    // retention; every other import remains untouched.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/94
    const specifier = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : "";
    const importClause = statement.importClause;
    const namedBindings = importClause?.namedBindings;
    if (
      (specifier !== "zod" && specifier !== "zod/v4") ||
      importClause?.isTypeOnly ||
      importClause?.name ||
      statement.attributes ||
      !namedBindings ||
      !ts.isNamedImports(namedBindings) ||
      namedBindings.elements.length !== 1
    ) {
      continue;
    }

    const element = namedBindings.elements[0];
    const importedName = element.propertyName?.text ?? element.name.text;
    if (element.isTypeOnly || importedName !== "z") continue;

    // A dependency may carry a required notice inside the declaration, so issue #94's size
    // optimization must leave commented imports byte-for-byte intact.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/94
    const statementSource = source.slice(statement.getStart(sourceFile), statement.end);
    if (/\/[/*]/.test(statementSource)) continue;

    const quotedSpecifier = source.slice(
      statement.moduleSpecifier.getStart(sourceFile),
      statement.moduleSpecifier.end
    );
    output =
      output.slice(0, statement.getStart(sourceFile)) +
      `import * as ${element.name.text} from ${quotedSpecifier};` +
      output.slice(statement.end);
  }
  return output;
}

function legalError(message) {
  throw new Error(`[bundle-size-guard] ${message}`);
}

function dedupeEsbuildLegalComments(source) {
  const labels = [...source.matchAll(/\/\*! Bundled license information:/g)];
  if (labels.length === 0) legalError("missing esbuild legal-comment block");
  if (labels.length !== 1) legalError("multiple esbuild legal-comment blocks");

  const blockStart = labels[0].index;
  if (!source.startsWith(LEGAL_BLOCK_PREFIX, blockStart))
    legalError("malformed esbuild legal-comment block header");

  const blockEnd = source.indexOf(LEGAL_BLOCK_SUFFIX, blockStart + LEGAL_BLOCK_PREFIX.length);
  if (blockEnd < 0) legalError("malformed esbuild legal-comment block footer");
  if (blockEnd + LEGAL_BLOCK_SUFFIX.length !== source.length)
    legalError("esbuild legal-comment block is not at EOF");

  const entriesSource = source.slice(blockStart + LEGAL_BLOCK_PREFIX.length, blockEnd);
  const entryPattern = /([^\n]+):\n( {2}\([\s\S]*?\))\n(?:\n|$)/g;
  const groupedEntries = new Map();
  let cursor = 0;
  let match;
  while ((match = entryPattern.exec(entriesSource)) !== null) {
    if (match.index !== cursor) {
      legalError("incomplete esbuild legal-comment parse");
    }
    const group = groupedEntries.get(match[2]);
    if (group) group.count += 1;
    else groupedEntries.set(match[2], { path: match[1], count: 1 });
    cursor = entryPattern.lastIndex;
  }

  // A partially parsed license block could silently discard a notice, so issue #94 requires
  // the build to fail closed: https://github.com/Brevilabs/obsidian-copilot-private/issues/94
  if (cursor !== entriesSource.length || groupedEntries.size === 0) {
    legalError("incomplete esbuild legal-comment parse");
  }

  const entries = [...groupedEntries.entries()]
    .map(([body, { path: firstPath, count }]) => {
      const label = count === 1 ? firstPath : `${firstPath} (+${count - 1} identical notices)`;
      return `${label}:\n${body}\n`;
    })
    .join("\n");

  return `${source.slice(0, blockStart)}${LEGAL_BLOCK_PREFIX}${entries}${LEGAL_BLOCK_SUFFIX}`;
}

function assertBundleSize(source, maxBytes = MAX_BUNDLE_BYTES) {
  // The sync limit is decimal 5 MB and rejects equality, so the release artifact must stay
  // strictly below it. https://github.com/Brevilabs/obsidian-copilot-private/issues/94
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes >= maxBytes) {
    throw new Error(
      `[bundle-size-guard] main.js is ${bytes} bytes; it must be strictly below ${maxBytes} bytes`
    );
  }
  return bytes;
}

function createBundleSizeGuard({ production }) {
  return {
    name: "bundle-size-guard",
    setup(build) {
      build.onLoad({ filter: DEPENDENCY_SOURCE }, async (args) => {
        const source = await fs.promises.readFile(args.path, "utf8");
        const contents = rewriteExactZodImports(source, args.path);
        if (contents === source) return;
        const loader = LOADERS[path.extname(args.path).toLowerCase()] ?? "js";
        return { contents, loader, resolveDir: path.dirname(args.path) };
      });

      // The Sync limit applies to the production artifact; watch builds keep their original
      // notice block and skip release-only enforcement for issue #94.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/94
      if (!production) return;
      build.onEnd((result) => {
        if (result.errors.length > 0) return;
        const outfile = build.initialOptions.outfile;
        if (!outfile) throw new Error("[bundle-size-guard] expected an outfile");

        const source = fs.readFileSync(outfile, "utf8");
        const output = dedupeEsbuildLegalComments(source);
        assertBundleSize(output);
        fs.writeFileSync(outfile, output, "utf8");
      });
    },
  };
}

module.exports = {
  assertBundleSize,
  createBundleSizeGuard,
  dedupeEsbuildLegalComments,
  rewriteExactZodImports,
};
