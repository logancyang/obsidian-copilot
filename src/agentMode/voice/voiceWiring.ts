import { type App, Notice } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { getAgentVoiceSettings, getSettings } from "@/settings/model";
import { VoiceSessionController } from "@/agentMode/voice/VoiceSessionController";
import { VoiceTransportSpike } from "@/agentMode/voice/voiceTransportSpike";
import { readVoiceCredential } from "@/agentMode/voice/voiceCredential";
import { createWindowVoiceHost } from "@/agentMode/voice/windowVoiceHost";

/**
 * Builds the transport harness used by the voice check command. Each run
 * resolves the window that currently owns the Agent chat, so a call started
 * from a popout captures and plays in that popout.
 *
 * @param plugin Plugin instance supplying the workspace and the keychain.
 */
export function createVoiceTransportSpike(plugin: CopilotPlugin): VoiceTransportSpike {
  return new VoiceTransportSpike({
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
    describeCall: () => ({
      conversationId: `voice-check-${uuidv4()}`,
      backendDisplayName: getSettings().agentMode.activeBackend,
    }),
    newTaskId: () => `voice-check-task-${uuidv4()}`,
    notify: (message) => {
      new Notice(message);
    },
  });
}

/** The Agent chat's own window, or null when no Agent chat is open. */
function resolveAgentViewWindow(app: App): Window | null {
  const leaf = app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE)[0];
  return leaf ? leaf.view.containerEl.win : null;
}
