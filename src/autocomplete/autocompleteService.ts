import { AUTOCOMPLETE_CONFIG } from "@/constants";
import { logError, logInfo } from "@/logger";
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

    this.cmIntegration = CodeMirrorIntegration.getInstance({
      delay: AUTOCOMPLETE_CONFIG.DELAY_MS,
      minTriggerLength: AUTOCOMPLETE_CONFIG.MIN_TRIGGER_LENGTH,
      maxContextLength: AUTOCOMPLETE_CONFIG.MAX_CONTEXT_LENGTH,
    });

    // Subscribe to settings changes
    this.unsubscribeSettings = subscribeToSettingsChange((prev, next) => {
      // Only need to handle enableAutocomplete changes
      if (prev.enableAutocomplete !== next.enableAutocomplete) {
        logInfo(`Settings changed - enableAutocomplete: ${next.enableAutocomplete}`);
        this.cmIntegration.setActive(next.enableAutocomplete);
      }
    });

    // Set initial active state
    this.cmIntegration.setActive(settings.enableAutocomplete);

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
      logError("Failed to register CodeMirror extension:", error);
    }
  }

  destroy() {
    logInfo("Destroying AutocompleteService");
    this.unsubscribeSettings();
    this.cmIntegration.setActive(false);
  }
}
