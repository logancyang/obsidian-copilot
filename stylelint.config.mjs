export default {
  defaultSeverity: "warning",
  extends: ["stylelint-config-obsidianmd"],
  rules: {
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
