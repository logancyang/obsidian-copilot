import obsidianStylelintConfig from "stylelint-config-obsidianmd";

export default {
  defaultSeverity: "warning",
  plugins: obsidianStylelintConfig.plugins,
  rules: {
    ...obsidianStylelintConfig.rules,
    "declaration-block-no-duplicate-properties": null,
    "plugin/no-unsupported-browser-features": [
      true,
      {
        severity: "warning",
        browsers: ["electron >= 43"],
        ignore: [
          "css-nesting",
          "css-cascade-layers",
          "multicolumn",
          "extended-system-fonts",
          "text-decoration",
        ],
      },
    ],
  },
};
