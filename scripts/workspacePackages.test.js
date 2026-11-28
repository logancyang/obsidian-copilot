/** @jest-environment node */
const path = require("path");
const esbuild = require("esbuild");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const PACKAGES = ["core", "protocol", "client"];
const PACKAGE_DEPENDENCIES = {
  core: ["core"],
  protocol: ["core", "protocol"],
  client: ["core", "protocol", "client"],
};

function entryOf(name) {
  return path.join(root, "packages", name, "src", "index.ts");
}

function resolveWithTsconfig(tsconfigPath, specifier) {
  const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(tsconfigPath));
  const importer = path.join(path.dirname(tsconfigPath), "src", "importer.ts");
  const resolved = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule;
  return resolved && path.normalize(resolved.resolvedFileName);
}

describe("workspace packages", () => {
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
