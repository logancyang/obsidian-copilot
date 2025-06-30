import { AUTOCOMPLETE_CONFIG } from "@/constants";
import { logError } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { Plugin } from "obsidian";
import { CodeMirrorIntegration } from "./codemirrorIntegration";

export class AutocompleteService {
  private static instance: AutocompleteService;
  private cmIntegration: CodeMirrorIntegration;
  private unsubscribeSettings: () => void;

  private constructor(private plugin: Plugin) {
    // Initialize with current settings
    const settings = getSettings();

    // Create CodeMirror integration
    this.cmIntegration = CodeMirrorIntegration.getInstance({
      delay: AUTOCOMPLETE_CONFIG.DELAY_MS,
      minTriggerLength: AUTOCOMPLETE_CONFIG.MIN_TRIGGER_LENGTH,
      maxContextLength: AUTOCOMPLETE_CONFIG.MAX_CONTEXT_LENGTH,
    });

    // Subscribe to settings changes
    this.unsubscribeSettings = subscribeToSettingsChange((prev, next) => {
      // Handle changes to autocomplete settings AND Plus user status
      const prevActive =
        (prev.enableAutocomplete || prev.enableWordCompletion) && prev.isPlusUser === true;
      const nextActive =
        (next.enableAutocomplete || next.enableWordCompletion) && next.isPlusUser === true;

      if (prevActive !== nextActive) {
        this.cmIntegration.setActive(nextActive);
      }
    });

    // Set initial active state - active only if completion is enabled AND user is Plus
    const initialActive =
      (settings.enableAutocomplete || settings.enableWordCompletion) &&
      settings.isPlusUser === true;
    this.cmIntegration.setActive(initialActive);

    // Register the extension globally
    this.registerExtension();
  }

  static getInstance(plugin: Plugin): AutocompleteService {
    if (!AutocompleteService.instance) {
      AutocompleteService.instance = new AutocompleteService(plugin);
    }
    return AutocompleteService.instance;
  }

  private registerExtension() {
    try {
      this.plugin.registerEditorExtension([this.cmIntegration.getExtension()]);
    } catch (error) {
      logError("[Copilot Autocomplete] Failed to register CodeMirror extension:", error);
    }
  }

  destroy() {
    this.unsubscribeSettings();
    this.cmIntegration.setActive(false);
    this.cmIntegration.destroy();
  }
}
