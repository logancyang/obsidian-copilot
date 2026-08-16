export default {
  defaultSeverity: "warning",
  extends: ["stylelint-config-obsidianmd"],
  plugins: ["./scripts/stylelint-no-important-at-rule.mjs"],
  rules: {
    // Error rather than this file's warning default, because a warning does not
    // fail the gate and the authored stylesheet holds none of these. An
    // !important denies community themes any normal-weight override, and almost
    // everything it is reached for — app chrome, theme rules — is already
    // winnable on selector specificity. Blocking makes each new one an explicit
    // review decision instead of a line that slips in unnoticed.
    //
    // stylelint.packaged.config.mjs scans the generated bundle separately and
    // keeps this at warning, because Tailwind's `!`-prefixed utilities
    // (`!tw-border-none` and friends, authored in TSX) legitimately emit
    // !important into styles.css.
    "declaration-no-important": [true, { severity: "error" }],
    // Covers the `@apply utility !important;` form, which is an at-rule prelude
    // rather than a declaration and so is invisible to the rule above.
    "copilot/no-important-at-rule": [true, { severity: "error" }],
    "selector-class-pattern": [
      "^[a-z][a-z0-9_/-]*$",
      {
        message:
          "Expected class selector to use the repository's kebab-case, BEM, or Tailwind syntax",
      },
    ],
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: ["apply", "config", "container", "layer", "property", "tailwind"],
        severity: "warning",
      },
    ],
  },
};
