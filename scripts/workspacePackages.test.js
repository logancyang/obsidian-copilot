/** @jest-environment node */
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const ts = require("typescript");
const { lintWithRepoConfig } = require("./testing/lintWithRepoConfig");

const root = path.resolve(__dirname, "..");
const PACKAGES = ["core", "protocol", "client"];
const APP = "apps/obsidian";
const MANIFESTS = [
  "package.json",
  `${APP}/package.json`,
  ...PACKAGES.map((name) => `packages/${name}/package.json`),
];
const SLOW_TEST_MS = 120000;
const PACKAGE_DEPENDENCIES = {
  core: ["core"],
  protocol: ["core", "protocol"],
  client: ["core", "protocol", "client"],
};

function entryOf(name) {
  return path.join(root, "packages", name, "src", "index.ts");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function librariesOf(manifest) {
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
    (name) => !name.startsWith("@copilot/")
  );
}

function sourceFiles(folder) {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [relative] : [];
  });
}

function resolveWithTsconfig(tsconfigPath, specifier) {
  const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(tsconfigPath));
  const importer = path.join(path.dirname(tsconfigPath), "src", "importer.ts");
  const resolved = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule;
  return resolved && path.normalize(resolved.resolvedFileName);
}

describe("workspace packages", () => {
  it("installs apps/obsidian as the private workspace package @copilot/obsidian, as npm ci does", () => {
    const lockfile = readJson("package-lock.json");

    expect(readJson(`${APP}/package.json`)).toMatchObject({
      name: "@copilot/obsidian",
      private: true,
    });
    expect(lockfile.packages["node_modules/@copilot/obsidian"]).toEqual({
      resolved: APP,
      link: true,
    });
  });

  it("lists every library in exactly one package.json and gives the root no runtime dependencies", () => {
    const listings = MANIFESTS.flatMap((file) => librariesOf(readJson(file)));
    const listedTwice = listings.filter((name, index) => listings.indexOf(name) !== index);

    expect(listedTwice).toEqual([]);
    expect(readJson("package.json").dependencies).toBeUndefined();
  });

  it("declares in the app all three @copilot packages, including every one app source imports", () => {
    const imported = new Set(
      sourceFiles(`${APP}/src`).flatMap((file) =>
        [
          ...fs.readFileSync(path.join(root, file), "utf8").matchAll(/["'](@copilot\/[\w-]+)\//g),
        ].map(([, name]) => name)
      )
    );
    const declared = Object.keys(readJson(`${APP}/package.json`).dependencies).filter((name) =>
      name.startsWith("@copilot/")
    );

    expect(declared.sort()).toEqual(["@copilot/client", "@copilot/core", "@copilot/protocol"]);
    expect(declared).toEqual(expect.arrayContaining([...imported]));
  });

  it(
    "checks app files against the app's package.json and the gallery against both, and bans the same libraries in the app's package.json as in the root's",
    () => {
      const extraneous = (report) =>
        report.filter((line) => line.startsWith("import/no-extraneous-dependencies"));
      const banned = JSON.stringify({ dependencies: { axios: "^1.0.0" } });

      const [appSource, gallery, appManifest, rootManifest] = lintWithRepoConfig(root, [
        [`${APP}/src/DependencyProbe.js`, 'import "react";\nimport "esbuild";\n'],
        ["dev/gallery/main.ts", 'import "react";\nimport "esbuild";\n'],
        [`${APP}/package.json`, banned],
        ["package.json", banned],
      ]);

      expect(extraneous(appSource)).toEqual([
        "import/no-extraneous-dependencies: 'esbuild' should be listed in the project's dependencies. Run 'npm i -S esbuild' to add it",
      ]);
      expect(extraneous(gallery)).toEqual([]);
      expect(appManifest).toEqual(rootManifest);
      expect(appManifest).toEqual([expect.stringMatching(/^depend\/ban-dependencies: /)]);
    },
    SLOW_TEST_MS
  );

  it.each(PACKAGES)("Jest resolves @copilot/%s/index to the package's src/index.ts", (name) => {
    expect(require.resolve(`@copilot/${name}/index`)).toBe(entryOf(name));
  });

  it.each(["tsconfig.json", "apps/obsidian/tsconfig.json"])(
    "%s resolves every package by name, as the type check and the lint resolver do",
    (tsconfig) => {
      const resolved = PACKAGES.map((name) =>
        resolveWithTsconfig(path.join(root, tsconfig), `@copilot/${name}/index`)
      );

      expect(resolved).toEqual(PACKAGES.map(entryOf));
    }
  );

  it("bundles every package by name from plugin source, as the plugin build does", async () => {
    const { metafile } = await esbuild.build({
      stdin: {
        contents: PACKAGES.map((name) => `export * from "@copilot/${name}/index";`).join("\n"),
        resolveDir: path.join(root, "apps/obsidian/src"),
        loader: "ts",
      },
      absWorkingDir: root,
      bundle: true,
      write: false,
      metafile: true,
      logLevel: "silent",
    });

    expect(Object.keys(metafile.inputs)).toEqual(
      expect.arrayContaining(PACKAGES.map((name) => `packages/${name}/src/index.ts`))
    );
  });

  it.each(PACKAGES)(
    "packages/%s/tsconfig.json resolves only itself and the packages it depends on",
    (name) => {
      const tsconfig = path.join(root, "packages", name, "tsconfig.json");
      const resolvable = PACKAGES.filter((other) =>
        resolveWithTsconfig(tsconfig, `@copilot/${other}/index`)
      );

      expect(resolvable).toEqual(PACKAGE_DEPENDENCIES[name]);
    }
  );
});
