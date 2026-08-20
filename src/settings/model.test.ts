import { ChainType } from "@/chainType";
import {
  COPILOT_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
  BUILTIN_CHAT_MODELS,
  BUILTIN_EMBEDDING_MODELS,
} from "@/constants";
import {
  normalizeRootFolders,
  resetSettings,
  sanitizeEnvOverrides,
  sanitizeQaExclusions,
  sanitizeSettings,
  settingsAtom,
  settingsStore,
  validateCopilotFolder,
  CopilotSettings,
  getModelKeyFromModel,
} from "@/settings/model";
import { CustomModel } from "@/aiParams";
import { getEffectiveUserPrompt, getSystemPrompt } from "@/system-prompts/systemPromptBuilder";
import * as systemPromptsState from "@/system-prompts/state";
import * as settingsModel from "@/settings/model";

// Mock system-prompts state
jest.mock("@/system-prompts/state", () => ({
  getEffectiveSystemPromptContent: jest.fn(() => ""),
  getDisableBuiltinSystemPrompt: jest.fn(() => false),
}));

// Mock settings/model getSettings for legacy fallback tests
jest.mock("@/settings/model", () => {
  const actual = jest.requireActual<object>("@/settings/model");
  return {
    ...actual,
    getSettings: jest.fn(() => ({ userSystemPrompt: "" })),
  };
});

describe("sanitizeQaExclusions", () => {
  it("defaults to copilot root when value is not a string", () => {
    expect(sanitizeQaExclusions(undefined)).toBe(encodeURIComponent(DEFAULT_QA_EXCLUSIONS_SETTING));
  });

  it("keeps slash-only patterns distinct from canonical entries", () => {
    const rawValue = `${encodeURIComponent("///")},${encodeURIComponent(COPILOT_FOLDER_ROOT)}`;

    const sanitized = sanitizeQaExclusions(rawValue);

    expect(sanitized.split(",")).toEqual([
      encodeURIComponent("///"),
      encodeURIComponent(COPILOT_FOLDER_ROOT),
    ]);
  });

  it("normalizes trailing slashes to canonical path keys", () => {
    const rawValue = `${encodeURIComponent("folder/")},${encodeURIComponent("folder//")}`;

    const sanitized = sanitizeQaExclusions(rawValue);

    expect(sanitized.split(",")).toEqual([encodeURIComponent("folder/")]);
  });

  it("no longer force-injects the copilot root (system exclusion covers it)", () => {
    const rawValue = encodeURIComponent("folder");

    const sanitized = sanitizeQaExclusions(rawValue);

    expect(sanitized.split(",")).toEqual([encodeURIComponent("folder")]);
  });
});

describe("sanitizeSettings - defaultSendShortcut migration", () => {
  it("should use default when defaultSendShortcut is missing", () => {
    const settingsWithoutShortcut = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: undefined,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(settingsWithoutShortcut);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should use default when defaultSendShortcut is invalid", () => {
    const settingsWithInvalidShortcut = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: "invalid-shortcut",
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(settingsWithInvalidShortcut);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should preserve valid ENTER shortcut", () => {
    const settingsWithEnter = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: SEND_SHORTCUT.ENTER,
    };

    const sanitized = sanitizeSettings(settingsWithEnter);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should preserve valid SHIFT_ENTER shortcut", () => {
    const settingsWithShiftEnter = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: SEND_SHORTCUT.SHIFT_ENTER,
    };

    const sanitized = sanitizeSettings(settingsWithShiftEnter);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.SHIFT_ENTER);
  });
});

describe("sanitizeSettings - autoAddActiveContentToContext migration", () => {
  it("should migrate from old includeActiveNoteAsContext=true", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined,
      includeActiveNoteAsContext: true,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(true);
  });

  it("should migrate from old includeActiveNoteAsContext=false", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined,
      includeActiveNoteAsContext: false,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(false);
  });

  it("should use default when no old setting exists", () => {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(newSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(
      DEFAULT_SETTINGS.autoAddActiveContentToContext
    );
  });
});

describe("sanitizeSettings - autoAddSelectionToContext migration", () => {
  it("should migrate from old autoIncludeTextSelection=true", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined,
      autoIncludeTextSelection: true,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(true);
  });

  it("should migrate from old autoIncludeTextSelection=false", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined,
      autoIncludeTextSelection: false,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(false);
  });

  it("should use default when no old setting exists", () => {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(newSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(DEFAULT_SETTINGS.autoAddSelectionToContext);
  });
});

describe("sanitizeSettings - agentMode shape migration", () => {
  it("creates a default agentMode slice when missing", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: undefined as unknown as never,
    });
    expect(sanitized.agentMode).toEqual({
      byok: {},
      activeBackend: "opencode",
      backends: {},
      debugFullFrames: true,
      welcomeDismissed: false,
      skills: { folder: "copilot/skills" },
    });
  });

  it("defaults debugFullFrames to on for new installs", () => {
    expect(DEFAULT_SETTINGS.agentMode.debugFullFrames).toBe(true);
  });

  it("preserves an explicit debugFullFrames=false (a user who turned it off stays off)", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: {
        byok: {},
        activeBackend: "opencode",
        backends: {},
        debugFullFrames: false,
      },
    } as unknown as CopilotSettings);
    expect(sanitized.agentMode.debugFullFrames).toBe(false);
  });

  it("preserves an explicit debugFullFrames=true", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: {
        byok: {},
        activeBackend: "opencode",
        backends: {},
        debugFullFrames: true,
      },
    } as unknown as CopilotSettings);
    expect(sanitized.agentMode.debugFullFrames).toBe(true);
  });

  it("falls back to the on-by-default when debugFullFrames is absent or non-boolean", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: {
        byok: {},
        activeBackend: "opencode",
        backends: {},
        debugFullFrames: "yes" as unknown as boolean,
      },
    } as unknown as CopilotSettings);
    expect(sanitized.agentMode.debugFullFrames).toBe(true);
  });

  it("leaves backends empty when no legacy fields and no existing slice", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: { enabled: true, byok: {} },
    } as unknown as CopilotSettings);
    expect(sanitized.agentMode.backends).toEqual({});
  });

  it("preserves an already-migrated backends.opencode slice", () => {
    const migrated = {
      ...DEFAULT_SETTINGS,
      agentMode: {
        enabled: true,
        byok: {},
        activeBackend: "opencode",
        backends: {
          opencode: { binaryPath: "/new/opencode", binaryVersion: "2.0.0", binarySource: "custom" },
        },
      },
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(migrated);

    expect(sanitized.agentMode.backends.opencode).toEqual({
      binaryPath: "/new/opencode",
      binaryVersion: "2.0.0",
      binarySource: "custom",
    });
  });

  it("defaults binarySource to 'managed' when path is set but source is missing or invalid", () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      agentMode: {
        enabled: true,
        byok: {},
        backends: {
          opencode: { binaryPath: "/p", binaryVersion: "1.0.0", binarySource: "garbage" },
        },
      },
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(legacy);

    expect(sanitized.agentMode.backends.opencode?.binarySource).toBe("managed");
  });

  it("clears binarySource when no binaryPath is set", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      agentMode: {
        enabled: true,
        byok: {},
        backends: { opencode: { binarySource: "managed" } },
      },
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(settings);

    expect(sanitized.agentMode.backends.opencode).toEqual({
      binaryPath: undefined,
      binaryVersion: undefined,
      binarySource: undefined,
    });
  });
});

describe("sanitizeEnvOverrides", () => {
  it("returns undefined for non-objects", () => {
    expect(sanitizeEnvOverrides(undefined)).toBeUndefined();
    expect(sanitizeEnvOverrides(null)).toBeUndefined();
    expect(sanitizeEnvOverrides("foo")).toBeUndefined();
    expect(sanitizeEnvOverrides(42)).toBeUndefined();
    expect(sanitizeEnvOverrides([1, 2])).toBeUndefined();
  });

  it("returns undefined when no valid entries remain", () => {
    expect(sanitizeEnvOverrides({})).toBeUndefined();
    expect(sanitizeEnvOverrides({ "": "v", "1FOO": "v", "BAR=BAZ": "v" })).toBeUndefined();
  });

  it("keeps valid POSIX identifiers and string values", () => {
    expect(
      sanitizeEnvOverrides({
        CLAUDE_CONFIG_DIR: "/tmp/claude",
        _PRIVATE: "x",
        myVar2: "y",
      })
    ).toEqual({
      CLAUDE_CONFIG_DIR: "/tmp/claude",
      _PRIVATE: "x",
      myVar2: "y",
    });
  });

  it("drops keys with leading digits, equals signs, whitespace, or invalid characters", () => {
    expect(
      sanitizeEnvOverrides({
        "1FOO": "v",
        "FOO BAR": "v",
        "FOO=BAR": "v",
        "FOO-BAR": "v",
        VALID: "v",
      })
    ).toEqual({ VALID: "v" });
  });

  it("drops entries whose value isn't a string or contains control chars", () => {
    expect(
      sanitizeEnvOverrides({
        OK: "fine",
        NUM: 42,
        NULLED: null,
        UNDEF: undefined,
        TABS: "ok\twith\ttabs", // tab is a control char — drop
        NEWLINE: "ok\nnewline", // drop
      })
    ).toEqual({ OK: "fine" });
  });

  it("caps at 64 entries to bound persisted size", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 100; i++) big[`VAR_${i}`] = String(i);
    const sanitized = sanitizeEnvOverrides(big);
    expect(sanitized && Object.keys(sanitized).length).toBe(64);
  });

  it("round-trips through sanitizeSettings on the Claude backend slice", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      agentMode: {
        enabled: true,
        byok: {},
        activeBackend: "claude",
        backends: {
          claude: { envOverrides: { CLAUDE_CONFIG_DIR: "/x", "BAD KEY": "y" } },
        },
      },
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(settings);

    expect(sanitized.agentMode.backends.claude?.envOverrides).toEqual({
      CLAUDE_CONFIG_DIR: "/x",
    });
  });
});

describe("sanitizeSettings - legacy Miyo settings cleanup", () => {
  it("migrates legacy Miyo settings and strips obsolete remote vault path state", () => {
    const legacySettings = {
      ...DEFAULT_SETTINGS,
      enableMiyo: undefined,
      enableMiyoSearch: true,
      miyoServerUrl: "http://127.0.0.1:8742",
      miyoRemoteVaultPath: "\\\\Mac\\Home\\Downloads\\graham-essays-main",
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(legacySettings);

    expect(sanitized.enableMiyo).toBe(true);
    expect(sanitized.miyoServerUrl).toBe("http://127.0.0.1:8742");
    const sanitizedRecord = sanitized as unknown as Record<string, unknown>;

    expect("miyoRemoteVaultPath" in sanitizedRecord).toBe(false);
    expect("enableMiyoSearch" in sanitizedRecord).toBe(false);
  });

  it("defaults a missing or malformed miyoSyncedExclusions to an empty receipt", () => {
    const withoutReceipt = {
      ...DEFAULT_SETTINGS,
      miyoSyncedExclusions: undefined,
    } as unknown as CopilotSettings;
    expect(sanitizeSettings(withoutReceipt).miyoSyncedExclusions).toBe("");

    const malformed = {
      ...DEFAULT_SETTINGS,
      miyoSyncedExclusions: 42,
    } as unknown as CopilotSettings;
    expect(sanitizeSettings(malformed).miyoSyncedExclusions).toBe("");

    const preserved = {
      ...DEFAULT_SETTINGS,
      miyoSyncedExclusions: '{"device":"d","roots":[]}',
    };
    expect(sanitizeSettings(preserved).miyoSyncedExclusions).toBe('{"device":"d","roots":[]}');
  });

  it("preserves embedding provider migrations while stripping obsolete Miyo keys", () => {
    const legacySettings = {
      ...DEFAULT_SETTINGS,
      userId: "",
      activeEmbeddingModels: [
        {
          name: "legacy-embedding",
          provider: "azure_openai",
          enabled: true,
        },
      ],
      miyoRemoteVaultPath: "\\\\Mac\\Home\\Downloads\\graham-essays-main",
    };

    const sanitized = sanitizeSettings(legacySettings);
    const sanitizedRecord = sanitized as unknown as Record<string, unknown>;

    expect(sanitized.userId).toBeTruthy();
    expect(sanitized.activeEmbeddingModels[0].provider).not.toBe("azure_openai");
    expect("miyoRemoteVaultPath" in sanitizedRecord).toBe(false);
  });
});

describe("sanitizeSettings - legacy self-host migration", () => {
  it("renames legacy enableSelfHostedSearch=true to enableSelfHostMode", () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      enableSelfHostMode: undefined,
      enableSelfHostedSearch: true,
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(legacy);

    // Only the user preference carries over; entitlement comes from the signed
    // token, so there is no local receipt for sanitize to seed.
    expect(sanitized.enableSelfHostMode).toBe(true);
  });
});

describe("getSystemPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns only builtin prompt when no user prompt and builtin not disabled", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("returns builtin prompt with user custom instructions when user prompt exists", () => {
    const userPrompt = "Always be concise and helpful.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toBe(`${DEFAULT_SYSTEM_PROMPT}
<user_custom_instructions>
${userPrompt}
</user_custom_instructions>`);
  });

  it("returns only user prompt when builtin is disabled", () => {
    const userPrompt = "Custom system prompt only.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(true);

    const result = getSystemPrompt();

    expect(result).toBe(userPrompt);
    expect(result).not.toContain(DEFAULT_SYSTEM_PROMPT);
  });

  it("returns empty string when builtin is disabled and no user prompt", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(true);

    const result = getSystemPrompt();

    expect(result).toBe("");
  });

  it("wraps user prompt in user_custom_instructions tags", () => {
    const userPrompt = "Be professional.";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain("<user_custom_instructions>");
    expect(result).toContain("</user_custom_instructions>");
    expect(result).toContain(userPrompt);
  });

  it("preserves multiline user prompts", () => {
    const userPrompt = "Line 1\nLine 2\nLine 3";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(userPrompt);
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain(userPrompt);
    expect(result).toContain("Line 1\nLine 2\nLine 3");
  });

  it("calls getEffectiveSystemPromptContent to get user prompt", () => {
    getSystemPrompt();

    expect(systemPromptsState.getEffectiveSystemPromptContent).toHaveBeenCalled();
  });

  it("calls getDisableBuiltinSystemPrompt to check builtin status", () => {
    getSystemPrompt();

    expect(systemPromptsState.getDisableBuiltinSystemPrompt).toHaveBeenCalled();
  });

  it("respects priority: session > global default > empty", () => {
    // This is tested indirectly through getEffectiveSystemPromptContent
    // which is already tested in state.test.ts
    const sessionPrompt = "Session prompt content";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      sessionPrompt
    );
    (systemPromptsState.getDisableBuiltinSystemPrompt as jest.Mock).mockReturnValue(false);

    const result = getSystemPrompt();

    expect(result).toContain(sessionPrompt);
  });
});

describe("getEffectiveUserPrompt - legacy fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns file-based prompt when available", () => {
    const fileBasedPrompt = "File-based prompt content";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      fileBasedPrompt
    );
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "Legacy prompt",
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(fileBasedPrompt);
  });

  it("falls back to legacy userSystemPrompt when file-based is empty", () => {
    const legacyPrompt = "Legacy system prompt from settings";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(legacyPrompt);
  });

  it("returns empty string when both file-based and legacy are empty", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "",
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe("");
  });

  it("file-based prompt takes priority over legacy prompt", () => {
    const fileBasedPrompt = "File-based wins";
    const legacyPrompt = "Legacy loses";
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue(
      fileBasedPrompt
    );
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    const result = getEffectiveUserPrompt();

    expect(result).toBe(fileBasedPrompt);
    expect(result).not.toBe(legacyPrompt);
  });

  it("handles undefined getSettings gracefully", () => {
    (systemPromptsState.getEffectiveSystemPromptContent as jest.Mock).mockReturnValue("");
    (settingsModel.getSettings as jest.Mock).mockReturnValue(undefined);

    const result = getEffectiveUserPrompt();

    expect(result).toBe("");
  });
});

describe("normalizeModelProvider", () => {
  it("maps azure_openai to the EmbeddingModelProviders.AZURE_OPENAI value", () => {
    const { normalizeModelProvider } = jest.requireActual<{
      normalizeModelProvider: (provider: string) => string;
    }>("@/settings/model");
    // Reason: EmbeddingModelProviders.AZURE_OPENAI = "azure openai" (with space)
    expect(normalizeModelProvider("azure_openai")).toBe("azure openai");
  });

  it("passes through already-normalized and unrelated providers", () => {
    const { normalizeModelProvider } = jest.requireActual<{
      normalizeModelProvider: (provider: string) => string;
    }>("@/settings/model");
    expect(normalizeModelProvider("azure openai")).toBe("azure openai");
    expect(normalizeModelProvider("openai")).toBe("openai");
    expect(normalizeModelProvider("")).toBe("");
  });
});

describe("sanitizeSettings - docProcessorBackend (v6 field)", () => {
  it("defaults to 'plus' when missing", () => {
    const out = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      docProcessorBackend: undefined,
    } as unknown as CopilotSettings);
    expect(out.docProcessorBackend).toBe("plus");
  });

  it("resets an invalid value to 'plus'", () => {
    const out = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      docProcessorBackend: "bogus",
    } as unknown as CopilotSettings);
    expect(out.docProcessorBackend).toBe("plus");
  });

  it("preserves 'miyo'", () => {
    const out = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      docProcessorBackend: "miyo",
    });
    expect(out.docProcessorBackend).toBe("miyo");
  });
});

describe("model", () => {
  describe("sanitizeSettings()", () => {
    it("drops a persisted global output cap so it cannot truncate answers again (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", () => {
      const withRetiredCap = {
        ...DEFAULT_SETTINGS,
        maxTokens: 6000,
        temperature: 0.4,
      } as unknown as CopilotSettings;

      const sanitized = sanitizeSettings(withRetiredCap);

      expect("maxTokens" in (sanitized as unknown as Record<string, unknown>)).toBe(false);
      expect(sanitized.temperature).toBe(0.4);
    });

    function sanitizeClaudeSlice(autoModePermission: unknown): CopilotSettings {
      return sanitizeSettings({
        ...DEFAULT_SETTINGS,
        agentMode: {
          enabled: true,
          byok: {},
          activeBackend: "claude",
          backends: { claude: { autoModePermission } },
        },
      } as unknown as CopilotSettings);
    }

    it("keeps a Claude auto permission mode the SDK understands", () => {
      const sanitized = sanitizeClaudeSlice("acceptEdits");

      expect(sanitized.agentMode.backends.claude?.autoModePermission).toBe("acceptEdits");
    });

    it("drops an unsupported Claude auto permission mode so the descriptor default applies", () => {
      const sanitized = sanitizeClaudeSlice("dontAsk");

      expect(sanitized.agentMode.backends.claude?.autoModePermission).toBeUndefined();
    });

    it("coerces a retired `project` defaultChainType so chain construction never sees it (https://github.com/logancyang/obsidian-copilot-preview/issues/310)", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        defaultChainType: "project",
      } as unknown as CopilotSettings);

      expect(out.defaultChainType).toBe(DEFAULT_SETTINGS.defaultChainType);
    });

    it("keeps a defaultChainType the runner still supports", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        defaultChainType: ChainType.COPILOT_PLUS_CHAIN,
      });

      expect(out.defaultChainType).toBe(ChainType.COPILOT_PLUS_CHAIN);
    });

    it("defaults to the historical root when empty", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "",
      });
      expect(out.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
    });

    it("defaults to the historical root when whitespace-only", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "   ",
      });
      expect(out.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
    });

    it("trims surrounding whitespace from a custom value", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "  my-ai  ",
      });
      expect(out.copilotFolder).toBe("my-ai");
    });

    it("preserves a nested custom value", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "notes/ai",
      });
      expect(out.copilotFolder).toBe("notes/ai");
    });

    it("preserves an existing config-like root without vault context", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: ".vault-config/plugins/copilot-data",
      });

      expect(out.copilotFolder).toBe(".vault-config/plugins/copilot-data");
    });

    it("rejects a parent-traversal path", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "../escape",
      });
      expect(out.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
    });

    it("rejects a Windows drive-absolute path", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "C:/Users/evil",
      });
      expect(out.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
    });

    it("rejects a Unix-absolute path", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "/etc/passwd",
      });
      expect(out.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
    });

    it("unions the active root into a normalized, deduped history", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        copilotFolder: "team-ai",
        copilotRootHistory: ["copilot", "ai", "copilot"],
      });
      expect(new Set(out.copilotRootHistory)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it("guarantees the active root is present even when history is missing", () => {
      const raw = { ...DEFAULT_SETTINGS, copilotFolder: "ai" } as unknown as Record<
        string,
        unknown
      >;
      delete raw.copilotRootHistory;
      const out = sanitizeSettings(raw as unknown as CopilotSettings);
      expect(out.copilotRootHistory).toContain("ai");
    });

    it("coerces a non-boolean upgrade flag to the default", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        upgradedToV8FromLegacy: undefined,
      } as unknown as CopilotSettings);
      expect(out.upgradedToV8FromLegacy).toBe(false);
    });

    it("preserves a true upgrade flag", () => {
      const out = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        upgradedToV8FromLegacy: true,
      });
      expect(out.upgradedToV8FromLegacy).toBe(true);
    });
  });

  describe("validateCopilotFolder()", () => {
    it("rejects empty and whitespace-only values", () => {
      expect(validateCopilotFolder("").ok).toBe(false);
      expect(validateCopilotFolder("   ").ok).toBe(false);
    });

    it("accepts a simple relative folder and trims it", () => {
      expect(validateCopilotFolder("  my-ai  ")).toEqual({ ok: true, folder: "my-ai" });
    });

    it("accepts a nested relative folder and strips a trailing slash", () => {
      expect(validateCopilotFolder("notes/ai/")).toEqual({ ok: true, folder: "notes/ai" });
    });

    it("rejects parent-traversal, absolute, and drive-letter paths", () => {
      expect(validateCopilotFolder("../escape").ok).toBe(false);
      expect(validateCopilotFolder("a/../b").ok).toBe(false);
      expect(validateCopilotFolder("/etc/passwd").ok).toBe(false);
      expect(validateCopilotFolder("C:/Users/evil").ok).toBe(false);
    });

    it("rejects a lone dot segment", () => {
      expect(validateCopilotFolder("a/./b").ok).toBe(false);
    });

    it("rejects roots that overlap the active config folder at a segment boundary", () => {
      const configDir = ".vault-config";
      expect(validateCopilotFolder(configDir, configDir).ok).toBe(false);
      expect(validateCopilotFolder(`${configDir.toUpperCase()}/plugins`, configDir).ok).toBe(false);
      expect(validateCopilotFolder("copilot", "copilot/system-prompts").ok).toBe(false);
      expect(validateCopilotFolder("copilot-data", "copilot/system-prompts").ok).toBe(true);
    });

    it("rejects Windows-illegal characters in any segment", () => {
      expect(validateCopilotFolder("a/b<c").ok).toBe(false);
      expect(validateCopilotFolder('a/b"c').ok).toBe(false);
      expect(validateCopilotFolder("a/b|c").ok).toBe(false);
    });

    it("rejects Windows-reserved device names in any segment, any case, with or without extension", () => {
      expect(validateCopilotFolder("NUL").ok).toBe(false);
      expect(validateCopilotFolder("team/CON").ok).toBe(false);
      expect(validateCopilotFolder("con.md").ok).toBe(false);
      expect(validateCopilotFolder("Com1").ok).toBe(false);
      // Names that merely CONTAIN a reserved word stay valid.
      expect(validateCopilotFolder("console").ok).toBe(true);
      expect(validateCopilotFolder("nul-notes").ok).toBe(true);
    });

    it("rejects segments ending with a dot or space on every platform", () => {
      expect(validateCopilotFolder("copilot.").ok).toBe(false);
      expect(validateCopilotFolder("team /ai").ok).toBe(false);
      expect(validateCopilotFolder("team./ai").ok).toBe(false);
    });

    it("agrees with sanitizeSettings on the copilotFolder fallback contract", () => {
      // sanitizeSettings must coerce every value validateCopilotFolder rejects to
      // the default; a value it accepts must survive verbatim.
      for (const value of ["../escape", "/etc/passwd", "C:/x", "", "NUL", "copilot."]) {
        const out = sanitizeSettings({ ...DEFAULT_SETTINGS, copilotFolder: value });
        expect(out.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
      }
      const kept = sanitizeSettings({ ...DEFAULT_SETTINGS, copilotFolder: "team/ai" });
      expect(kept.copilotFolder).toBe("team/ai");
    });
  });

  describe("normalizeRootFolders()", () => {
    it("preserves case and strips trailing slashes without lowercasing", () => {
      expect(normalizeRootFolders(["Copilot/", "ai//"])).toEqual(["Copilot", "ai"]);
    });

    it("dedupes case-sensitively, preserving first-seen order", () => {
      expect(normalizeRootFolders(["copilot", "ai", "copilot", "Copilot"])).toEqual([
        "copilot",
        "ai",
        "Copilot",
      ]);
    });

    it("drops empty, non-string, and vault-escaping entries", () => {
      expect(
        normalizeRootFolders([
          "",
          "   ",
          undefined,
          "../escape",
          "a/../b",
          "/etc",
          "C:\\Users\\Josh",
          "notes/ai",
        ])
      ).toEqual(["notes/ai"]);
    });

    it("collapses interior duplicate slashes into the matcher's canonical form", () => {
      expect(normalizeRootFolders(["a//b"])).toEqual(["a/b"]);
    });

    it("strips interior single-dot segments into the matcher's canonical form", () => {
      expect(normalizeRootFolders(["a/./b"])).toEqual(["a/b"]);
    });

    it("leaves an already-canonical legitimate root unchanged", () => {
      expect(normalizeRootFolders(["a/b"])).toEqual(["a/b"]);
    });

    it("canonicalizes before deduping and traversal filtering", () => {
      expect(normalizeRootFolders(["a//b", "a/./b", "x/../y", "a/b"])).toEqual(["a/b"]);
    });
  });

  describe("resetSettings()", () => {
    it("preserves historical roots and folds in the pre-reset active root", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        copilotFolder: "team-ai",
        copilotRootHistory: ["copilot", "ai"],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
      // Legacy + historical + pre-reset active root all survive the reset.
      expect(new Set(after.copilotRootHistory)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it("preserves providers with keychain credentials (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        providers: {
          byok_openai: {
            providerId: "byok_openai",
            providerType: "openai-compatible",
            displayName: "My OpenAI",
            apiKeyKeychainId: "keychain-id-123",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
          byok_anthropic: {
            providerId: "byok_anthropic",
            providerType: "anthropic",
            displayName: "No Key",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
        },
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.providers.byok_openai).toBeDefined();
      expect(after.providers.byok_openai.apiKeyKeychainId).toBe("keychain-id-123");
      expect(after.providers.byok_anthropic).toBeUndefined();
    });

    it.each([false, true])(
      "preserves a builtin model's credential routing, including enableCors=%s, while resetting its preferences (https://github.com/logancyang/obsidian-copilot-preview/issues/259)",
      (enableCors) => {
        // Reason: the endpoint has to survive alongside the key. Resetting only
        // baseUrl would leave a proxy credential pointed at the provider's
        // default host, sending the user's key somewhere they never configured.
        // `enableCors` is the one boolean in the bundle — `false` surviving is
        // exactly what its dedicated `carriesConfiguration` branch exists for.
        const customGpt4: CustomModel = {
          ...BUILTIN_CHAT_MODELS[0],
          enabled: false,
          apiKey: "sk-saved",
          baseUrl: "https://proxy.example.test/v1",
          openAIOrgId: "org-model",
          enableCors,
          temperature: 0.9,
        };
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          activeModels: [customGpt4],
        });

        resetSettings();

        const after = settingsStore.get(settingsAtom);
        const restored = after.activeModels.find(
          (m) => getModelKeyFromModel(m) === getModelKeyFromModel(BUILTIN_CHAT_MODELS[0])
        );
        expect(restored).toBeDefined();
        expect(restored!.apiKey).toBe("sk-saved");
        expect(restored!.baseUrl).toBe("https://proxy.example.test/v1");
        expect(restored!.openAIOrgId).toBe("org-model");
        expect(restored!.enableCors).toBe(enableCors);
        expect(restored!.enabled).toBe(BUILTIN_CHAT_MODELS[0].enabled);
        expect(restored!.temperature).toBe(BUILTIN_CHAT_MODELS[0].temperature);
      }
    );

    it("preserves every custom model, including rows that carry no key (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      // Reason: the keychain is the sole secret store, so an empty in-memory
      // apiKey may just mean this session's keychain read failed. Dropping the
      // row would strand the entry with no identity left to reattach it to.
      const withKey: CustomModel = {
        name: "my-llama",
        provider: "openai",
        enabled: true,
        apiKey: "sk-custom",
        baseUrl: "http://localhost:1234",
      };
      const withoutKey: CustomModel = {
        name: "ollama-llama",
        provider: "ollama",
        enabled: true,
      };
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        activeModels: [withKey, withoutKey],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      const myLlama = after.activeModels.find((m) => m.name === "my-llama");
      expect(myLlama?.apiKey).toBe("sk-custom");
      expect(myLlama?.baseUrl).toBe("http://localhost:1234");
      expect(after.activeModels.find((m) => m.name === "ollama-llama")).toBeDefined();
    });

    it("filters out null/undefined top-level secrets", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        openAIApiKey: "valid-key",
        plusLicenseKey: "lic-12345",
        anthropicApiKey: null as unknown as string,
        googleApiKey: undefined as unknown as string,
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.openAIApiKey).toBe("valid-key");
      expect(after.plusLicenseKey).toBe("lic-12345");
      expect(after.anthropicApiKey).toBe(DEFAULT_SETTINGS.anthropicApiKey);
      expect(after.googleApiKey).toBe(DEFAULT_SETTINGS.googleApiKey);
    });

    it("preserves the top-level vendor config a retained key needs to reach its service (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      // Reason: these are not secrets, so the secret-key heuristic misses them,
      // but a key without them is unusable — Azure composes its request URL
      // from the instance/deployment/version trio.
      const vendorConfig = {
        openAIOrgId: "org-123",
        azureOpenAIApiInstanceName: "my-instance",
        azureOpenAIApiDeploymentName: "chat-deploy",
        azureOpenAIApiVersion: "2025-01-01-preview",
        azureOpenAIApiEmbeddingDeploymentName: "embed-deploy",
      };
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, ...vendorConfig });

      resetSettings();

      expect(settingsStore.get(settingsAtom)).toMatchObject(vendorConfig);
    });

    it("drops the entitlement token, whose identity binding reset invalidates (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      // Reason: `verifyEntitlement` checks the token against `settings.userId`,
      // and reset replaces that with a fresh uuid — a carried-over token could
      // never verify again. `plusLicenseKey` is the credential worth keeping;
      // the next license check re-issues the token from it.
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        plusLicenseKey: "lic-12345",
        entitlementToken: "test-stale-entitlement-token",
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.plusLicenseKey).toBe("lic-12345");
      expect(after.entitlementToken).toBe(DEFAULT_SETTINGS.entitlementToken);
    });

    it("keeps a signed-in user's paid state so reset never reads as sign-out (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      // Reason: the settings subscriber treats an `isPaidUser` flip as
      // sign-out and tears down the Plus provider, its models, and its
      // keychain entry — destroying exactly what reset preserves. The strict
      // `isPlusUser` flag still resets: its proof (the entitlement token) is
      // dropped, and the next validation re-derives it.
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        isPaidUser: true,
        isPlusUser: true,
        plusLicenseKey: "lic-12345",
        entitlementToken: "test-stale-entitlement-token",
        entitlementExpiresAt: 4_000_000_000_000,
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.isPaidUser).toBe(true);
      // The expiry travels with the paid flag: it is tighten-only, and
      // zeroing it would leave the license UI showing Active forever while
      // offline.
      expect(after.entitlementExpiresAt).toBe(4_000_000_000_000);
      expect(after.plusLicenseKey).toBe("lic-12345");
      expect(after.isPlusUser).toBe(DEFAULT_SETTINGS.isPlusUser);
      expect(after.entitlementToken).toBe(DEFAULT_SETTINGS.entitlementToken);
    });

    it("drops a bundle value whose type its consumer cannot handle (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      // Reason: a hand-edited or cross-version `data.json` can hold a non-string
      // where a string is expected. Carrying it through reset would move the
      // failure to the consumer — embeddingManager concatenates the API version
      // into the request URL.
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        azureOpenAIApiKey: "azure-key",
        azureOpenAIApiVersion: {} as unknown as string,
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.azureOpenAIApiKey).toBe("azure-key");
      expect(after.azureOpenAIApiVersion).toBe(DEFAULT_SETTINGS.azureOpenAIApiVersion);
    });

    it("preserves the Azure routing fields on a builtin embedding row alongside its key (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      // Reason: Azure is the one builtin row whose request URL is assembled
      // from per-row fields (embeddingManager reads instance + embedding
      // deployment + version). Keeping only the key would leave it pointed at
      // an address that cannot be built.
      const azureDefault = BUILTIN_EMBEDDING_MODELS.find((m) => m.provider === "azure openai");
      expect(azureDefault).toBeDefined();
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        activeEmbeddingModels: [
          {
            ...azureDefault!,
            apiKey: "az-key",
            azureOpenAIApiInstanceName: "my-instance",
            azureOpenAIApiEmbeddingDeploymentName: "embed-deploy",
            azureOpenAIApiVersion: "2025-01-01-preview",
            enabled: false,
          },
        ],
      });

      resetSettings();

      const restored = settingsStore
        .get(settingsAtom)
        .activeEmbeddingModels.find(
          (m) => getModelKeyFromModel(m) === getModelKeyFromModel(azureDefault!)
        );
      expect(restored).toMatchObject({
        apiKey: "az-key",
        azureOpenAIApiInstanceName: "my-instance",
        azureOpenAIApiEmbeddingDeploymentName: "embed-deploy",
        azureOpenAIApiVersion: "2025-01-01-preview",
      });
      expect(restored!.enabled).toBe(azureDefault!.enabled);
    });

    it("filters out null/undefined model secrets", () => {
      const modelWithNull: CustomModel = {
        ...BUILTIN_CHAT_MODELS[0],
        apiKey: null as unknown as string,
      };
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        activeModels: [modelWithNull],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      const restored = after.activeModels.find(
        (m) => getModelKeyFromModel(m) === getModelKeyFromModel(BUILTIN_CHAT_MODELS[0])
      );
      expect(restored).toBeDefined();
      expect(restored!.apiKey).toBe(BUILTIN_CHAT_MODELS[0].apiKey);
    });

    it("preserves configured models belonging to preserved providers (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      const providerId1 = "prov-with-key";
      const providerId2 = "prov-no-key";
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        providers: {
          [providerId1]: {
            providerId: providerId1,
            providerType: "openai-compatible",
            displayName: "Provider With Key",
            apiKeyKeychainId: "kc-123",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
          [providerId2]: {
            providerId: providerId2,
            providerType: "openai-compatible",
            displayName: "Provider No Key (Ollama)",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
        },
        configuredModels: [
          {
            configuredModelId: "model-1",
            providerId: providerId1,
            info: { id: "gpt-4", displayName: "GPT-4" },
            configuredAt: Date.now(),
          },
          {
            configuredModelId: "model-2",
            providerId: providerId2,
            info: { id: "llama3", displayName: "Llama 3" },
            configuredAt: Date.now(),
          },
        ],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.providers[providerId1]).toBeDefined();
      expect(after.providers[providerId2]).toBeUndefined();
      expect(after.configuredModels.length).toBe(1);
      expect(after.configuredModels[0].configuredModelId).toBe("model-1");
      expect(after.configuredModels[0].providerId).toBe(providerId1);
    });

    it("clears backends regardless of preserved providers", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        providers: {
          prov1: {
            providerId: "prov1",
            providerType: "openai-compatible",
            displayName: "Provider",
            apiKeyKeychainId: "kc-123",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
        },
        backends: {
          chat: { enabledModels: ["model-1", "model-2"] },
          opencode: { enabledModels: ["model-3"] },
        },
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.providers.prov1).toBeDefined();
      expect(after.backends).toEqual(DEFAULT_SETTINGS.backends);
    });
  });
});
