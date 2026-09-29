"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";
const PLUGIN = path.join(__dirname, "dedupeIdenticalPackages.js");
const ESBUILD = require.resolve("esbuild");

function writePackage(root, name, version, files) {
  const dir = path.join(root, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: path.basename(name), version, main: "index.js" })
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
      plugins: [createDedupeIdenticalPackages()],
    }).then((result) => process.stdout.write(result.outputFiles[0].text));
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

    it("keeps separate copies when the versions differ", () => {
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

    it("resolves subpath imports into the shared copy", () => {
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

    it("leaves relative imports and unresolved optional requires alone", () => {
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
  });
});
