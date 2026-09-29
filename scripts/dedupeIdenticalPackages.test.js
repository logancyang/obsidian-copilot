"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";
const PLUGIN = path.join(__dirname, "dedupeIdenticalPackages.js");
const ESBUILD = require.resolve("esbuild");

function writePackage(root, name, version, files, extraManifest = {}) {
  const dir = path.join(root, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: path.basename(name), version, main: "index.js", ...extraManifest })
  );
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), contents);
  }
}

function nestedRoot(root, host) {
  return path.join(root, "node_modules", host);
}

function bundle(root, entry) {
  const script = `
    const esbuild = require(${JSON.stringify(ESBUILD)});
    const { createDedupeIdenticalPackages } = require(${JSON.stringify(PLUGIN)});
    esbuild.build({
      entryPoints: [${JSON.stringify(path.join(root, entry))}],
      bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
      absWorkingDir: ${JSON.stringify(root)},
      plugins: [createDedupeIdenticalPackages()],
    }).then((result) => process.stdout.write(result.outputFiles[0].text));
  `;
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });
}

// Rebuilds one esbuild context, writes `installedFiles` (path to contents) between the two builds
// the way an npm install lands during a watch build, and returns the second output.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
function rebuildAfterInstall(root, entry, installedFiles) {
  const script = `
    const fs = require("node:fs");
    const esbuild = require(${JSON.stringify(ESBUILD)});
    const { createDedupeIdenticalPackages } = require(${JSON.stringify(PLUGIN)});
    (async () => {
      const context = await esbuild.context({
        entryPoints: [${JSON.stringify(path.join(root, entry))}],
        bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
      absWorkingDir: ${JSON.stringify(root)},
        plugins: [createDedupeIdenticalPackages()],
      });
      await context.rebuild();
      for (const [file, contents] of Object.entries(${JSON.stringify(installedFiles)})) {
        fs.writeFileSync(file, contents);
      }
      process.stdout.write((await context.rebuild()).outputFiles[0].text);
      await context.dispose();
    })();
  `;
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });
}

describe("dedupeIdenticalPackages", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dedupe-"));
    fs.writeFileSync(
      path.join(root, "entry.js"),
      'const a = require("a"); const host1 = require("host1"); const host2 = require("host2"); console.log(a, host1, host2);'
    );
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  describe("createDedupeIdenticalPackages()", () => {
    it(`bundles one copy of a package that npm nested next to several dependents at the same version (${ISSUE})`, () => {
      writePackage(root, "a", "1.2.4", {
        "index.js": 'module.exports = "SHARED_COPY_MARKER_ROOT";',
      });
      for (const host of ["host1", "host2"]) {
        writePackage(root, host, "1.0.0", { "index.js": 'module.exports = require("dep");' });
        fs.mkdirSync(path.join(nestedRoot(root, host), "node_modules"), { recursive: true });
      }
      writePackage(root, "host1/node_modules/dep", "2.0.0", {
        "index.js": 'module.exports = "DEP_COPY_MARKER";',
      });
      writePackage(root, "host2/node_modules/dep", "2.0.0", {
        "index.js": 'module.exports = "DEP_COPY_MARKER";',
      });

      const output = bundle(root, "entry.js");

      expect(output.match(/DEP_COPY_MARKER/g)).toHaveLength(1);
    });

    it(`keeps separate copies when the versions differ (${ISSUE})`, () => {
      writePackage(root, "a", "1.0.0", { "index.js": 'module.exports = "A_MARKER";' });
      for (const [host, version] of [
        ["host1", "1.0.0"],
        ["host2", "1.0.0"],
      ]) {
        writePackage(root, host, version, { "index.js": 'module.exports = require("dep");' });
      }
      writePackage(root, "host1/node_modules/dep", "1.0.0", {
        "index.js": 'module.exports = "DEP_V1";',
      });
      writePackage(root, "host2/node_modules/dep", "2.0.0", {
        "index.js": 'module.exports = "DEP_V2";',
      });

      const output = bundle(root, "entry.js");

      expect(output).toContain("DEP_V1");
      expect(output).toContain("DEP_V2");
    });

    it(`resolves subpath imports into the shared copy (${ISSUE})`, () => {
      writePackage(root, "a", "1.0.0", { "index.js": 'module.exports = "A";' });
      for (const host of ["host1", "host2"]) {
        writePackage(root, host, "1.0.0", {
          "index.js": 'module.exports = require("dep/lib/util.js");',
        });
      }
      for (const host of ["host1", "host2"]) {
        writePackage(root, `${host}/node_modules/dep`, "3.0.0", {
          "index.js": "module.exports = 1;",
          "lib/util.js": 'module.exports = "UTIL_MARKER";',
        });
      }

      const output = bundle(root, "entry.js");

      expect(output.match(/UTIL_MARKER/g)).toHaveLength(1);
    });

    it(`leaves relative imports and unresolved optional requires alone (${ISSUE})`, () => {
      writePackage(root, "a", "1.0.0", {
        "index.js":
          'let extra; try { extra = require("missing-optional-package"); } catch {} module.exports = extra || "A_OK";',
      });
      writePackage(root, "host1", "1.0.0", {
        "index.js": "module.exports = require('./helper.js');",
        "helper.js": 'module.exports = "HELPER_OK";',
      });
      writePackage(root, "host2", "1.0.0", { "index.js": 'module.exports = "H2";' });

      const output = bundle(root, "entry.js");

      expect(output).toContain("HELPER_OK");
      expect(output).toContain("A_OK");
    });
    it(`keeps both copies of a package whose declared dependency resolves to a different version beside each copy (${ISSUE})`, () => {
      writePackage(root, "a", "1.0.0", { "index.js": 'module.exports = "A";' });
      writePackage(root, "peer", "2.0.0", { "index.js": 'module.exports = "PEER_V2";' });
      for (const host of ["host1", "host2"]) {
        writePackage(root, host, "1.0.0", { "index.js": 'module.exports = require("dep");' });
        writePackage(
          root,
          `${host}/node_modules/dep`,
          "1.0.0",
          { "index.js": 'module.exports = require("peer") + "_VIA_DEP";' },
          { dependencies: { peer: "*" } }
        );
      }
      writePackage(root, "host1/node_modules/peer", "1.0.0", {
        "index.js": 'module.exports = "PEER_V1";',
      });

      const output = bundle(root, "entry.js");

      expect(output).toContain("PEER_V1");
      expect(output).toContain("PEER_V2");
      expect(output.match(/_VIA_DEP/g)).toHaveLength(2);
    });

    it(`bundles one copy when the declared dependencies beside each copy are themselves identical copies (${ISSUE})`, () => {
      writePackage(root, "a", "1.0.0", { "index.js": 'module.exports = "A";' });
      for (const host of ["host1", "host2"]) {
        writePackage(root, host, "1.0.0", { "index.js": 'module.exports = require("dep");' });
        writePackage(
          root,
          `${host}/node_modules/dep`,
          "1.0.0",
          { "index.js": 'module.exports = require("leaf") + "_VIA_DEP";' },
          { dependencies: { leaf: "*" } }
        );
        writePackage(root, `${host}/node_modules/leaf`, "3.0.0", {
          "index.js": 'module.exports = "LEAF_MARKER";',
        });
      }

      const output = bundle(root, "entry.js");

      expect(output.match(/_VIA_DEP/g)).toHaveLength(1);
      expect(output.match(/LEAF_MARKER/g)).toHaveLength(1);
    });

    it(`keeps both copies when the files differ although the name and version match (${ISSUE})`, () => {
      writePackage(root, "a", "1.0.0", { "index.js": 'module.exports = "A";' });
      writePackage(root, "host1", "1.0.0", { "index.js": 'module.exports = require("dep");' });
      writePackage(root, "host2", "1.0.0", { "index.js": 'module.exports = require("dep");' });
      writePackage(root, "host1/node_modules/dep", "1.0.0", {
        "index.js": 'module.exports = "DEP_ORIGINAL";',
      });
      writePackage(root, "host2/node_modules/dep", "1.0.0", {
        "index.js": 'module.exports = "DEP_PATCHED";',
      });

      const output = bundle(root, "entry.js");

      expect(output).toContain("DEP_ORIGINAL");
      expect(output).toContain("DEP_PATCHED");
    });

    it(`bundles the same copy of an identical package whichever dependent imports it first (${ISSUE})`, () => {
      writePackage(root, "a", "1.0.0", { "index.js": 'module.exports = "A";' });
      for (const host of ["host1", "host2"]) {
        writePackage(root, host, "1.0.0", { "index.js": 'module.exports = require("dep");' });
        writePackage(root, `${host}/node_modules/dep`, "1.0.0", {
          "index.js": 'module.exports = "DEP_COPY_MARKER";',
        });
      }
      fs.writeFileSync(
        path.join(root, "swapped.js"),
        'const host2 = require("host2"); const host1 = require("host1"); console.log(host1, host2);'
      );

      const copiedFrom = (entry) =>
        bundle(root, entry).match(/\/\/ .*node_modules\/host\d\/node_modules\/dep\/index\.js/g);

      expect(copiedFrom("entry.js")).toEqual(copiedFrom("swapped.js"));
      expect(copiedFrom("entry.js")).toHaveLength(1);
    });

    it(`does not reuse a package identity from an earlier build after an install replaced its version (${ISSUE})`, () => {
      writePackage(root, "a", "1.0.0", { "index.js": 'module.exports = "A";' });
      writePackage(root, "host1", "1.0.0", { "index.js": 'module.exports = require("dep");' });
      writePackage(root, "host2", "1.0.0", { "index.js": 'module.exports = require("dep");' });
      for (const host of ["host1", "host2"]) {
        writePackage(root, `${host}/node_modules/dep`, "1.0.0", {
          "index.js": 'module.exports = "DEP_V1";',
        });
      }
      const replacedDir = path.join(root, "node_modules", "host2", "node_modules", "dep");

      const rebuilt = rebuildAfterInstall(root, "entry.js", {
        [path.join(replacedDir, "package.json")]: JSON.stringify({
          name: "dep",
          version: "2.0.0",
          main: "index.js",
        }),
        [path.join(replacedDir, "index.js")]: 'module.exports = "DEP_V2";',
      });

      expect(rebuilt).toContain("DEP_V1");
      expect(rebuilt).toContain("DEP_V2");
    });
  });
});
