"use strict";

const fs = require("fs");

const patchRendererUnsafeUnref = {
  name: "patch-renderer-unsafe-unref",
  setup(build) {
    build.onEnd((result) => {
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

      const sdkBundled = source.includes("@anthropic-ai/claude-agent-sdk");

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

        console.log("[patch-renderer-unsafe-unref] no sites to rewrite (SDK not bundled yet)");
        return;
      }

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

      console.log(`[patch-renderer-unsafe-unref] rewrote ${totalRewritten} site(s)`);
    });
  },
};

function findUnsafeSites(source) {
  const NEEDLE = "setTimeout(";
  const sites = [];
  let i = 0;
  while (i <= source.length - NEEDLE.length) {
    const at = source.indexOf(NEEDLE, i);
    if (at === -1) break;
    if (at > 0) {
      const prev = source.charCodeAt(at - 1);
      const isIdentChar =
        (prev >= 0x30 && prev <= 0x39) ||
        (prev >= 0x41 && prev <= 0x5a) ||
        (prev >= 0x61 && prev <= 0x7a) ||
        prev === 0x24 ||
        prev === 0x5f ||
        prev === 0x2e;
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
    const setTimeoutEnd = closeIdx + 1;
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

function skipString(source, i, quote) {
  i++;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && source[i + 1] === "{") {
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
