import {
  COPILOT_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
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
} from "@/settings/model";
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
      mcpServers: [],
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
        mcpServers: [],
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
        mcpServers: [],
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
        mcpServers: [],
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
      agentMode: { enabled: true, byok: {}, mcpServers: [] },
    } as unknown as CopilotSettings);
    expect(sanitized.agentMode.backends).toEqual({});
  });

  it("preserves an already-migrated backends.opencode slice", () => {
    const migrated = {
      ...DEFAULT_SETTINGS,
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
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
        mcpServers: [],
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
        mcpServers: [],
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
        mcpServers: [],
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

    it("rejects the Obsidian config folder case-insensitively", () => {
      // eslint-disable-next-line obsidianmd/hardcoded-config-path -- the test asserts rejection of the conventional config dir literal
      expect(validateCopilotFolder(".obsidian").ok).toBe(false);
      expect(validateCopilotFolder(".Obsidian/plugins").ok).toBe(false);
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
  });
});
