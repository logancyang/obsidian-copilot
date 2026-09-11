import { Notice, Platform, type App } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import type { BackendId } from "@/agentMode/session/types";
import { getAgentVoiceSettings, getSettings } from "@/settings/model";
import { VoiceSessionController } from "@/agentMode/voice/VoiceSessionController";
import {
  VoiceConversationBridge,
  type VoiceChatBinding,
} from "@/agentMode/voice/VoiceConversationBridge";
import { readVoiceCredential } from "@/agentMode/voice/voiceCredential";
import { createWindowVoiceHost } from "@/agentMode/voice/windowVoiceHost";

/** What the voice command drives. One per plugin instance. */
export interface VoiceCommandHandle {
  /** Start voice in the active Agent chat, or end the call already running. */
  toggle(): Promise<void>;
}

/**
 * Build the plugin's single voice owner and bind it to the active Agent chat.
 *
 * Every call resolves the window that currently owns the Agent chat, so a call
 * started from a popout captures and plays there. Following the active chat is
 * also what ends voice when the user switches chat, project, or backend: the
 * previous chat detaches, and detaching closes its call.
 *
 * @param plugin - Supplies the workspace, the session manager, and the keychain.
 * @param resolveBackendName - Backend id to display name, injected because the
 *   transport layer may not read the backend registry.
 */
export function createVoiceCommand(
  plugin: CopilotPlugin,
  resolveBackendName: (backendId: BackendId) => string
): VoiceCommandHandle {
  const bridge = new VoiceConversationBridge({
    createCall: () => {
      const ownerWindow = resolveAgentViewWindow(plugin.app);
      if (!ownerWindow) return null;
      const host = createWindowVoiceHost(ownerWindow);
      return {
        controller: new VoiceSessionController({
          host,
          readSettings: () => getAgentVoiceSettings(getSettings()),
          resolveCredential: () =>
            readVoiceCredential(plugin.app, getAgentVoiceSettings(getSettings())),
          newEventId: () => uuidv4(),
        }),
        timers: host.timers,
      };
    },
    checkEnvironment: () => describeVoiceBlocker(plugin.app),
    newSubmissionId: () => `voice-submission-${uuidv4()}`,
  });

  const manager = plugin.agentSessionManager;
  if (manager) {
    plugin.register(
      bridge.followActiveChat({
        subscribe: (listener) => manager.subscribe(listener),
        getActiveBinding: (): VoiceChatBinding | null => {
          const session = manager.getActiveSession();
          const chat = session ? manager.getChatUIState(session.internalId) : null;
          if (!session || !chat) return null;
          return {
            conversation: session,
            chat,
            backendDisplayName: resolveBackendName(session.backendId),
            getSelectedBackendIds: () => session.getLastMentionedAgents(),
            resolveSubmission: (text) => chat.resolveVoiceSubmission(text),
          };
        },
      })
    );
  }
  plugin.register(() => {
    void bridge.dispose();
  });

  return {
    toggle: async () => {
      const controls = manager?.getActiveChatUIState()?.getVoiceControls() ?? null;
      if (!controls) {
        new Notice("Open a Copilot Agent chat first — voice belongs to a conversation.");
        return;
      }
      if (bridge.getActiveConversationId() !== null) {
        await controls.end();
        new Notice("Voice ended. Your conversation and any running task are unchanged.");
        return;
      }
      const outcome = await controls.start();
      new Notice(outcome.started ? "Voice is on." : outcome.reason);
    },
  };
}

/**
 * Why voice cannot open a call right now, or null when it can. Checked before
 * any media or billable session is created.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Copilot domain contracts".
 */
function describeVoiceBlocker(app: App): string | null {
  if (Platform.isMobile) return "Voice chat is desktop-only.";
  const settings = getAgentVoiceSettings(getSettings());
  if (!settings.enabled) return "Voice is turned off in Copilot settings.";
  if (!settings.serverUrl.trim()) return "Add the voice server URL in Copilot settings.";
  if (!readVoiceCredential(app, settings)) {
    return "Add the voice server credential in Copilot settings.";
  }
  return null;
}

/** The Agent chat's own window, or null when no Agent chat is open. */
function resolveAgentViewWindow(app: App): Window | null {
  const leaf = app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE)[0];
  return leaf ? leaf.view.containerEl.win : null;
}
