import stylelint from "stylelint";

// `declaration-no-important` only inspects declarations. Tailwind's supported
// `@apply utility !important;` form is parsed as an at-rule with the bang in its
// prelude, so that rule never sees it and the utility still compiles to an
// !important in the generated bundle. This closes that path for every at-rule
// prelude, so the authored stylesheets cannot ship an !important in any form.
const ruleName = "copilot/no-important-at-rule";

const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (name) => `Disallowed !important in @${name} prelude`,
});

const meta = { url: "https://github.com/logancyang/obsidian-copilot-preview/issues/294" };

const ruleFunction = (primary) => (root, result) => {
  if (!stylelint.utils.validateOptions(result, ruleName, { actual: primary, possible: [true] })) {
    return;
  }

  root.walkAtRules((atRule) => {
    if (!/!\s*important\b/i.test(atRule.params)) return;
    stylelint.utils.report({
      message: messages.rejected(atRule.name),
      node: atRule,
      result,
      ruleName,
      word: "!important",
    });
  });
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default stylelint.createPlugin(ruleName, ruleFunction);
