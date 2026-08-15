import { transform as svgrTransform } from "@svgr/core";
import jsxPlugin from "@svgr/plugin-jsx";
import { readFile } from "node:fs/promises";

// Inline SVGR plugin: each `import Foo from "./foo.svg"` resolves to a React
// component (`React.FC<SVGProps<SVGSVGElement>>`) instead of a raw string.
// Source SVGs use `fill="currentColor"`, so theme color follows automatically.
const svgrPlugin = {
  name: "svgr",
  setup(build) {
    build.onLoad({ filter: /\.svg$/ }, async (args) => {
      const svg = await readFile(args.path, "utf8");
      const contents = await svgrTransform(
        svg,
        { jsxRuntime: "classic", typescript: false, plugins: [jsxPlugin] },
        { filePath: args.path, caller: { name: "esbuild-plugin-inline-svgr" } }
      );
      return { contents, loader: "jsx" };
    });
  },
};

export default svgrPlugin;
