import obsidianmd from "eslint-plugin-obsidianmd";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import tailwind from "eslint-plugin-tailwindcss";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "styles.css",
      "data.json",
      "designdocs/**",
      "docs/**",
    ],
  },

  // obsidianmd recommended brings:
  //   - eslint:recommended
  //   - typescript-eslint recommendedTypeChecked on .ts/.tsx (recommended on .js/.jsx)
  //   - obsidianmd plugin + all obsidianmd-namespaced rules
  //   - import / @microsoft/sdl / depend / no-unsanitized
  //   - Obsidian-injected globals (activeDocument, createDiv, etc.)
  ...obsidianmd.configs.recommended,

  // React + tailwind plugins ship flat configs with no `files` filter, so
  // they'd cascade onto package.json (which uses the JSON parser) and crash.
  // Constrain them to JSX/TSX sources where React/JSX rules actually apply.
  {
    files: ["**/*.{jsx,tsx}"],
    ...eslintReact.configs.recommended,
  },
  {
    files: ["**/*.{jsx,tsx}"],
    rules: {
      // Deferred to follow-up PRs — these flag legitimate anti-patterns but
      // each fix requires per-component intent analysis, and they're surfaced
      // as warnings (not errors) so they don't block CI.
      //
      // no-direct-set-state-in-use-effect: ~50 violations. Common pattern is
      // "sync local state with prop", which has no one-size-fits-all fix —
      // some cases want render-time derivation, others want a `key` prop reset
      // or `useSyncExternalStore`. Refactoring blindly risks behavior regressions
      // in the chat UI's stateful components.
      "@eslint-react/hooks-extra/no-direct-set-state-in-use-effect": "warn",
    },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  ...tailwind.configs["flat/recommended"].map((cfg) => ({
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ...cfg,
  })),

  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        // Obsidian plugin runtime injects `app` as a global (see CLAUDE.md).
        app: "readonly",
      },
    },
    settings: {
      "react-x": { version: "detect" },
      tailwindcss: {
        callees: ["classnames", "clsx", "ctl", "cn", "cva"],
        config: "./tailwind.config.js",
        cssFiles: ["**/*.css", "!**/node_modules", "!**/.*", "!**/dist", "!**/build"],
        // Obsidian-provided utility classes used in JSX but not defined in our CSS.
        whitelist: ["clickable-icon"],
      },
    },
    rules: {
      // Carry-over from legacy .eslintrc
      "no-prototype-builtins": "off",
      "tailwindcss/classnames-order": "error",
      "tailwindcss/enforces-negative-arbitrary-values": "error",
      "tailwindcss/enforces-shorthand": "error",
      "tailwindcss/migration-from-tailwind-2": "error",
      "tailwindcss/no-arbitrary-value": "off",
      "tailwindcss/no-custom-classname": "error",
      "tailwindcss/no-contradicting-classname": "error",

      // obsidianmd: defer to follow-up PRs
      "obsidianmd/ui/sentence-case": "off",

      // obsidianmd: disabled intentionally — Platform.isMacOS branching is on-purpose
      "obsidianmd/platform": "off",

      // Bundled by obsidianmd/recommended via tseslint.configs.recommendedTypeChecked.
      // Disabled here because the codebase intentionally uses `any` / dynamic typing
      // around Obsidian's untyped APIs and LangChain message shapes — flipping these
      // on would require refactoring thousands of call sites with no functional gain.
      //
      // Violation counts (src/**/*.{ts,tsx}) are noted inline. Rules with low counts
      // are candidates to enable in small follow-up PRs.

      // --- Heavy: any-flow through Obsidian/LangChain APIs ---
      // no-unsafe-member-access: enabled globally; tests and heavy source files
      // are exempted via per-file overrides below (see "no-unsafe-member-access
      // exemptions"). Remaining source files (≤5 violations each) were fixed in
      // this PR.
      "@typescript-eslint/no-unsafe-assignment": "off", // enabled for tests below; follow-up PR for production
      "@typescript-eslint/no-unsafe-call": "off", // 107 violations

      // --- Medium: promise / method ergonomics ---
      // Enabled in the TS-only block below.

      // no-deprecated: defer — surface the warnings, but don't fail CI yet
      "@typescript-eslint/no-deprecated": "off",

      // SDL / import / no-unsanitized / depend: defer — review separately
      "no-restricted-globals": "off",
    },
  },

  // Test files need Jest globals
  {
    files: ["**/*.test.{js,jsx,ts,tsx}", "jest.setup.js", "__mocks__/**"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      "import/no-nodejs-modules": "off",
      // Tests use intentional `any` mocks; disable type-safety rules that flood
      // the test suite without adding signal.
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },

  // no-unsafe-member-access exemptions: heavy source files that flow `any`
  // through Obsidian / LangChain / Bedrock APIs. Counts are current as of the
  // PR that enabled the rule; pick these off one at a time in follow-up PRs.
  {
    files: [
      "src/LLMProviders/BedrockChatModel.ts", // 106
      "src/LLMProviders/ChatOpenRouter.ts", // 28
      "src/LLMProviders/CustomOpenAIEmbeddings.ts", // 16
      "src/LLMProviders/brevilabsClient.ts", // 7
      "src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts", // 13
      "src/LLMProviders/chainRunner/BaseChainRunner.ts", // 7
      "src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts", // 55
      "src/LLMProviders/chainRunner/VaultQAChainRunner.ts", // 9
      "src/LLMProviders/chainRunner/utils/ActionBlockStreamer.ts", // 8
      "src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts", // 33
      "src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts", // 17
      "src/LLMProviders/chainRunner/utils/citationUtils.ts", // 11
      "src/LLMProviders/chainRunner/utils/finishReasonDetector.ts", // 29
      "src/LLMProviders/chainRunner/utils/modelAdapter.ts", // 9
      "src/LLMProviders/chainRunner/utils/promptPayloadRecorder.ts", // 12
      "src/LLMProviders/chainRunner/utils/searchResultUtils.ts", // 81
      "src/LLMProviders/chainRunner/utils/toolExecution.ts", // 9
      "src/LLMProviders/chatModelManager.ts", // 9
      "src/LLMProviders/selfHostServices.ts", // 9
      "src/commands/customCommandManager.ts", // 10
      "src/commands/customCommandUtils.ts", // 10
      "src/commands/index.ts", // 14
      "src/components/chat-components/ChatControls.tsx", // 8
      "src/components/chat-components/ChatInput.tsx", // 14
      "src/components/modals/SourcesModal.tsx", // 33
      "src/contextProcessor.ts", // 17
      "src/core/ChatPersistenceManager.ts", // 10
      "src/encryptionService.ts", // 6
      "src/projects/projectUtils.ts", // 38
      "src/search/chunkedStorage.ts", // 28
      "src/search/dbOperations.ts", // 27
      "src/search/hybridRetriever.ts", // 11
      "src/search/indexOperations.ts", // 15
      "src/search/v3/TieredLexicalRetriever.ts", // 9
      "src/settings/providerModels.ts", // 20
      "src/system-prompts/systemPromptUtils.ts", // 9
      "src/tools/FileParserManager.ts", // 11
      "src/tools/SearchTools.ts", // 11
      "src/tools/ToolResultFormatter.ts", // 106
      "src/utils.ts", // 49
      "src/utils/rateLimitUtils.ts", // 10
    ],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },

  // Tests have been cleaned of unsafe `any` assignments. Production code
  // (~499 violations) is a follow-up; keep tests enforced.
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
    },
  },

  // Integration tests bootstrap jsdom fetch via `node-fetch` polyfill —
  // allow the otherwise-banned import here only.
  {
    files: ["src/integration_tests/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  // Node-context files (build configs, scripts)
  {
    files: [
      "*.{js,mjs,cjs}",
      "scripts/**",
      "esbuild.config.mjs",
      "version-bump.mjs",
      "wasmPlugin.mjs",
      "nodeModuleShim.mjs",
      "jest.config.js",
      "tailwind.config.js",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "import/no-nodejs-modules": "off",
    },
  },

  // TypeScript-specific overrides (the @typescript-eslint plugin is registered
  // by obsidianmd's recommended config only for .ts/.tsx files).
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
      // checksVoidReturn relaxed for:
      //   - attributes: async event handlers in JSX (onClick={async () => ...}) are
      //     the standard React pattern; React already handles them correctly.
      //   - inheritedMethods: Obsidian's Plugin.onload/onunload are commonly async.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false, inheritedMethods: false } },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/unbound-method": "error",
      // TypeScript handles undefined-identifier detection (and does so cross-realm
      // correctly); per typescript-eslint's own guidance, disable no-undef on TS.
      "no-undef": "off",
    },
  },

  // Non-TS files aren't in tsconfig.json — disable type-aware rules that
  // obsidianmd's recommended config enables globally. Most typed obsidianmd
  // rules are already gated to **/*.ts(x); only no-plugin-as-component leaks
  // out via recommendedPluginRulesConfig, and @typescript-eslint/no-deprecated
  // is enabled globally.
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx", "**/package.json"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/no-plugin-as-component": "off",
    },
  },

  // package.json: keep depend/ban-dependencies enabled (from obsidianmd
  // recommended) but allow the deps we deliberately keep.
  {
    files: ["**/package.json"],
    rules: {
      "depend/ban-dependencies": [
        "error",
        {
          presets: ["native", "microutilities", "preferred"],
          allowed: [],
        },
      ],
    },
  },

  // logger.ts is the central logging utility and must call console.* directly.
  // scripts/** are CLI tools that print to stdout.
  {
    files: ["src/logger.ts", "scripts/**"],
    rules: {
      "obsidianmd/rule-custom-message": "off",
    },
  },

  // Jest assertions like `expect(mock.method).toHaveBeenCalled()` reference
  // methods unbound by design. The rule has no clean workaround for jest
  // patterns (binding changes the reference identity and breaks the assertion),
  // so disable it in tests. Scoped to .ts/.tsx because the @typescript-eslint
  // plugin is only registered for those files. Placed last so it overrides the
  // TS-only block above.
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
];
