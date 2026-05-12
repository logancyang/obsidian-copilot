// __mocks__/pierre-diffs-react.js
// Test-only stub for @pierre/diffs/react. The real package uses ESM subpath
// exports that ts-jest's resolver can't handle without extra configuration,
// and tests don't exercise Pierre's rendering anyway — they just need the
// module to resolve so anything importing ApplyView can compile.
/* eslint-disable no-undef */
import React from "react";

module.exports = {
  PatchDiff: function PatchDiff() {
    return React.createElement("div", { "data-testid": "pierre-patch-diff-stub" });
  },
  registerCustomCSSVariableTheme: function () {
    /* no-op in tests */
  },
};
