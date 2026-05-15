/**
 * Guardrail: every React root in this plugin must go through
 * `createPluginRoot` so descendants can rely on `useApp()` unconditionally.
 *
 * The fix in PR #2466 (Quick Ask crashed because `QuickAskOverlay` mounted
 * its own React root without `AppContext.Provider`) is a class of bug we
 * want to make structurally impossible. Hence: this test fails if any
 * file under `src/` imports `createRoot` from `react-dom/client` except
 * the helper itself.
 */

import { promises as fs } from "fs";
import path from "path";

const REPO_SRC = path.resolve(__dirname, "..", "..");
const HELPER_REL = path.posix.join("utils", "react", "createPluginRoot.tsx");

/**
 * Recursively collect all .ts/.tsx files under {@link dir}, excluding
 * test files (which are free to import anything for fixture setup).
 */
async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectSourceFiles(full)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    results.push(full);
  }
  return results;
}

describe("createPluginRoot guardrail", () => {
  it("no file in src/ imports createRoot from react-dom/client except the helper", async () => {
    const files = await collectSourceFiles(REPO_SRC);
    const offenders: string[] = [];
    // Match named imports of createRoot from react-dom/client, ignoring
    // whitespace/aliases. Catches `import { createRoot }`,
    // `import { createRoot as foo }`, and `import { Root, createRoot }`.
    const importRegex = /import\s*\{[^}]*\bcreateRoot\b[^}]*\}\s*from\s*["']react-dom\/client["']/;

    for (const file of files) {
      const rel = path.posix.relative(REPO_SRC, file).split(path.sep).join("/");
      if (rel === HELPER_REL) continue;
      const src = await fs.readFile(file, "utf8");
      if (importRegex.test(src)) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
