import obsidianStylelintConfig from "stylelint-config-obsidianmd";

// The packaged stylesheet is intentionally minified, so formatting rules from
// stylelint-config-standard cannot describe it meaningfully. Keep every
// Obsidian review policy from the official config here; the source stylesheet
// is checked separately with the complete config, including standard rules.
export default {
  defaultSeverity: "warning",
  plugins: obsidianStylelintConfig.plugins,
  rules: {
    ...obsidianStylelintConfig.rules,
    // Tailwind emits compatibility fallbacks as duplicate declarations.
    // The authored source receives this check from the complete official
    // config before the generated bundle is scanned.
    "declaration-block-no-duplicate-properties": null,
    "plugin/no-unsupported-browser-features": [
      true,
      {
        severity: "warning",
        browsers: ["electron >= 43"],
        // Tailwind deliberately emits these cross-browser fallbacks. Keep the
        // official rule active for every other unsupported browser feature.
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
