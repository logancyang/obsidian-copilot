/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("fs");

/**
 * Esbuild plugin: rewrite every `setTimeout(...).unref()` site in the bundled
 * output to `(t=>{t&&t.unref&&t.unref()})(setTimeout(...))`.
 *
 * Why: the `@anthropic-ai/claude-agent-sdk` process-transport-close path and
 * the transitive `@modelcontextprotocol/sdk` stdio-close-wait both call
 * `.unref()` on a `setTimeout` handle. In Electron's renderer process the
 * timer object lacks `.unref()`, and calling it crashes the renderer at
 * teardown. The wrapper preserves Node-side semantics and is a safe no-op
 * in the renderer.
 *
 * Runs as an `onEnd` plugin so it sees the final, post-minify, on-disk
 * output. After rewriting it re-scans the file and throws if any
 * unmatched site remains, failing the build.
 */
const patchRendererUnsafeUnref = {
  name: "patch-renderer-unsafe-unref",
  setup(build) {
    build.onEnd((result) => {
      // Skip when the build itself failed — esbuild has already surfaced errors.
      if (result.errors && result.errors.length > 0) return;

      const outfile = build.initialOptions.outfile;
      if (!outfile) {
        throw new Error(
          "[patch-renderer-unsafe-unref] expected build.initialOptions.outfile to be set"
        );
      }

      let source;
      try {
        source = fs.readFileSync(outfile, "utf8");
      } catch (err) {
        throw new Error(`[patch-renderer-unsafe-unref] failed to read ${outfile}: ${err.message}`);
      }

      // The SDKs whose unsafe `.unref()` sites motivate this patch
      // (@anthropic-ai/claude-agent-sdk, @modelcontextprotocol/sdk) only get
      // bundled once host code actually imports them. Until that happens the
      // bundle has no `setTimeout(...).unref()` sites — that's fine, the
      // patch becomes a no-op. The marker probe below distinguishes that
      // benign case from "SDK is bundled but the matcher failed."
      const sdkBundled = source.includes("@anthropic-ai/claude-agent-sdk");

      // Iterate: each pass finds all top-level `setTimeout(...).unref()`
      // sites, rewrites them right-to-left, and re-scans. Nested sites
      // (e.g. an inner `setTimeout(...).unref()` living inside an outer
      // setTimeout's argument list) are shadowed by their outer site on
      // any single pass, so without iteration the verifier complains they
      // remain. Cap at a few passes so a matcher bug can't infinite-loop.
      let out = source;
      let totalRewritten = 0;
      const MAX_PASSES = 8;
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const sites = findUnsafeSites(out);
        if (sites.length === 0) break;
        for (let i = sites.length - 1; i >= 0; i--) {
          const { setTimeoutStart, setTimeoutEnd, fullEnd } = sites[i];
          const setTimeoutCall = out.slice(setTimeoutStart, setTimeoutEnd);
          const wrapped = `(t=>{t&&t.unref&&t.unref()})(${setTimeoutCall})`;
          out = out.slice(0, setTimeoutStart) + wrapped + out.slice(fullEnd);
        }
        totalRewritten += sites.length;
      }

      if (totalRewritten === 0) {
        if (sdkBundled) {
          throw new Error(
            "[patch-renderer-unsafe-unref] @anthropic-ai/claude-agent-sdk " +
              "appears bundled but no `setTimeout(...).unref()` sites were " +
              "found. The matcher likely missed them after a minifier change."
          );
        }
        // eslint-disable-next-line no-console
        console.log("[patch-renderer-unsafe-unref] no sites to rewrite (SDK not bundled yet)");
        return;
      }

      // Verify: re-scan the final rewritten output. Any remaining site means
      // the scanner missed something or iteration didn't converge — fail
      // loud.
      const remaining = findUnsafeSites(out);
      if (remaining.length > 0) {
        throw new Error(
          `[patch-renderer-unsafe-unref] verifier found ${remaining.length} ` +
            "unsafe `setTimeout(...).unref()` site(s) still present after " +
            "rewrite. First site near offset " +
            remaining[0].setTimeoutStart +
            "."
        );
      }

      fs.writeFileSync(outfile, out, "utf8");
      // eslint-disable-next-line no-console
      console.log(`[patch-renderer-unsafe-unref] rewrote ${totalRewritten} site(s)`);
    });
  },
};

/**
 * Find every `setTimeout(<balanced>)\.unref\(\)` site in the source.
 * Returns an array sorted by offset.
 *
 * The scanner is string-literal-aware (single, double, backtick, and
 * line/block comments) so parentheses inside string contents don't
 * unbalance the count. Regex literals are intentionally not handled —
 * minified output rarely emits regex literals adjacent to `(` of a call,
 * and the SDK call sites are simple.
 */
function findUnsafeSites(source) {
  const NEEDLE = "setTimeout(";
  const sites = [];
  let i = 0;
  while (i <= source.length - NEEDLE.length) {
    const at = source.indexOf(NEEDLE, i);
    if (at === -1) break;
    // Reject identifier-prefixed matches like `mySetTimeout(` — the char before
    // must not be an identifier-continuation character or `.`.
    if (at > 0) {
      const prev = source.charCodeAt(at - 1);
      const isIdentChar =
        (prev >= 0x30 && prev <= 0x39) || // 0-9
        (prev >= 0x41 && prev <= 0x5a) || // A-Z
        (prev >= 0x61 && prev <= 0x7a) || // a-z
        prev === 0x24 || // $
        prev === 0x5f || // _
        prev === 0x2e; // .
      if (isIdentChar) {
        i = at + 1;
        continue;
      }
    }
    const setTimeoutStart = at;
    const argStart = at + NEEDLE.length;
    const closeIdx = findMatchingParen(source, argStart);
    if (closeIdx === -1) {
      i = at + 1;
      continue;
    }
    const setTimeoutEnd = closeIdx + 1; // one past the `)`
    if (source.startsWith(".unref()", setTimeoutEnd)) {
      sites.push({
        setTimeoutStart,
        setTimeoutEnd,
        fullEnd: setTimeoutEnd + ".unref()".length,
      });
      i = setTimeoutEnd + ".unref()".length;
    } else {
      i = at + 1;
    }
  }
  return sites;
}

/**
 * Given a position immediately after an opening `(`, return the index of
 * its matching `)`, accounting for nested parens, string literals
 * (`'`, `"`, `` ` ``), and `// ` / `/* ... *\/` comments. Returns -1 if
 * unbalanced.
 */
function findMatchingParen(source, start) {
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(source, i, ch);
      continue;
    }
    if (ch === "/" && i + 1 < source.length) {
      const next = source[i + 1];
      if (next === "/") {
        i = source.indexOf("\n", i + 2);
        if (i === -1) return -1;
        continue;
      }
      if (next === "*") {
        const end = source.indexOf("*/", i + 2);
        if (end === -1) return -1;
        i = end + 2;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Skip a string literal starting at `i` whose opening quote is `quote`.
 * Returns the index just past the closing quote. Handles backslash escapes.
 * For template literals, recursively skips `${...}` expressions.
 */
function skipString(source, i, quote) {
  i++; // past opening quote
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && source[i + 1] === "{") {
      // Skip the `${ ... }` interpolation, balancing inner braces.
      let depth = 1;
      let j = i + 2;
      while (j < source.length && depth > 0) {
        const c = source[j];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === "'" || c === '"' || c === "`") {
          j = skipString(source, j, c);
          continue;
        }
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return i;
}

module.exports = patchRendererUnsafeUnref;
