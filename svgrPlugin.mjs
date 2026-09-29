import { transform as svgrTransform } from "@svgr/core";
import jsxPlugin from "@svgr/plugin-jsx";
import { readFile } from "node:fs/promises";

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
