import {
  COPILOT_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
} from "@/constants";
import { sanitizeQaExclusions, sanitizeSettings } from "@/settings/model";

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

    expect(sanitized.split(",")).toEqual([
      encodeURIComponent("folder/"),
      encodeURIComponent(COPILOT_FOLDER_ROOT),
    ]);
  });
});

describe("sanitizeSettings - defaultSendShortcut migration", () => {
  it("should use default when defaultSendShortcut is missing", () => {
    const settingsWithoutShortcut = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: undefined as any,
    };

    const sanitized = sanitizeSettings(settingsWithoutShortcut);

    expect(sanitized.defaultSendShortcut).toBe(SEND_SHORTCUT.ENTER);
  });

  it("should use default when defaultSendShortcut is invalid", () => {
    const settingsWithInvalidShortcut = {
      ...DEFAULT_SETTINGS,
      defaultSendShortcut: "invalid-shortcut" as any,
    };

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
      autoAddActiveContentToContext: undefined as any,
      includeActiveNoteAsContext: true,
    };

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(true);
  });

  it("should migrate from old includeActiveNoteAsContext=false", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined as any,
      includeActiveNoteAsContext: false,
    };

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(false);
  });

  it("should use default when no old setting exists", () => {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      autoAddActiveContentToContext: undefined as any,
    };

    const sanitized = sanitizeSettings(newSettings);

    expect(sanitized.autoAddActiveContentToContext).toBe(DEFAULT_SETTINGS.autoAddActiveContentToContext);
  });
});

describe("sanitizeSettings - autoAddSelectionToContext migration", () => {
  it("should migrate from old autoIncludeTextSelection=true", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined as any,
      autoIncludeTextSelection: true,
    };

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(true);
  });

  it("should migrate from old autoIncludeTextSelection=false", () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined as any,
      autoIncludeTextSelection: false,
    };

    const sanitized = sanitizeSettings(oldSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(false);
  });

  it("should use default when no old setting exists", () => {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      autoAddSelectionToContext: undefined as any,
    };

    const sanitized = sanitizeSettings(newSettings);

    expect(sanitized.autoAddSelectionToContext).toBe(DEFAULT_SETTINGS.autoAddSelectionToContext);
  });
});
