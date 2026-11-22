import {
  agentSetupReason,
  deleteAgentAndArchiveChats,
  listAgentChatsToArchive,
  type AgentSetupProblem,
  type DeleteAgentResult,
} from "@/agents/agentMode/agentChats";
import type { HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import { openAgentFile } from "@/agents/agentMode/memorySaveCards";
import { useAgentProfileFacts } from "@/agents/agentMode/ui/useAgentProfileFacts";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { findUsedPresetIds, readAgentFaces } from "@/agents/presetFaces";
import { AgentDeleteModal } from "@/agents/ui/AgentDeleteModal";
import { AgentFacePicker, type PickedFace } from "@/agents/ui/AgentFacePicker";
import { AgentProfileView, countOf } from "@/agents/ui/AgentProfileView";
import { unlockCustomAgents } from "@/agents/ui/LockedAgentNotices";
import type { AgentModelChoices } from "@/agents/ui/CreateAgentForm";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import { usePresetFaces } from "@/agents/ui/usePresetFaces";
import { backendRegistry } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId } from "@/agentMode/session/types";
import { logError } from "@/logger";
import { Notice, type App } from "obsidian";
import React, { useEffect, useState } from "react";

export interface AgentProfileProps {
  agent: CustomAgent;
  app: App;
  manager: AgentSessionManager;
  store: CustomAgentStore;
  hiddenChats?: HiddenAgentChats;
  hostSessionId: string;
  getModels: () => AgentModelChoices;
  onBack: () => void;
  onNewChat: (agent: CustomAgent) => void;
  setupProblem?: AgentSetupProblem;
  onSetUp: (backendId: BackendId) => void;
}

export function agentDeleteNotice(
  name: string,
  { archivedChats, agentDeleted }: DeleteAgentResult
): string {
  if (!agentDeleted) return `Couldn't delete ${name}.`;
  return `Deleted ${name}${archivedChats > 0 ? ` and archived ${countOf(archivedChats, "chat")}` : ""}.`;
}

export function AgentProfile({
  agent,
  app,
  manager,
  store,
  hiddenChats,
  hostSessionId,
  getModels,
  onBack,
  onNewChat,
  setupProblem,
  onSetUp,
}: AgentProfileProps) {
  const facts = useAgentProfileFacts(app, manager, agent);
  const agents = useCustomAgents(store);
  const locked = useCustomAgentsGate() === "locked";
  const [models] = useState(getModels);
  const { slug, name } = agent;
  const failed = (change: string) => (error: unknown) => {
    logError(`[Custom agents] Changing ${slug}'s ${change} failed`, error);
    new Notice(`Couldn't change ${name}'s ${change}.`);
  };
  const confirmDelete = async () => {
    const chats = await listAgentChatsToArchive(manager, slug);
    new AgentDeleteModal(
      app,
      {
        agent,
        memoryRules: facts.memory?.rules ?? null,
        chatCount: chats.length,
        workingIn: hiddenChats?.workingIn(slug) ?? null,
      },
      () => void deleteAgent()
    ).open();
  };
  const deleteAgent = async () => {
    try {
      const result = await deleteAgentAndArchiveChats({
        app,
        manager,
        store,
        slug,
        hostSessionId,
        hiddenChats,
      });
      new Notice(agentDeleteNotice(name, result));
    } catch (error) {
      logError(`[Custom agents] Deleting ${slug} failed`, error);
      new Notice(`Couldn't delete ${name}.`);
    }
  };
  return (
    <AgentProfileView
      agent={agent}
      facts={facts}
      onBack={onBack}
      onNewChat={() => onNewChat(agent)}
      onOpenFile={(path) =>
        void openAgentFile(app, path).catch((error: unknown) =>
          logError(`[Custom agents] Could not open ${path}`, error)
        )
      }
      otherAgents={agents}
      models={models}
      renderFacePicker={(onPick) => (
        <ProfileFacePicker app={app} store={store} agent={agent} onPick={onPick} />
      )}
      onRename={(next) => store.updateAgent(slug, { name: next })}
      onRetitle={(title) => store.updateAgent(slug, { title })}
      onChangeFace={(face) => void store.saveFace(slug, face).catch(failed("face"))}
      onChangeModel={(model) => void store.updateAgent(slug, { model }).catch(failed("model"))}
      onDelete={() =>
        void confirmDelete().catch((error: unknown) =>
          logError(`[Custom agents] Could not list ${slug}'s chats`, error)
        )
      }
      locked={
        locked ? { onUnlock: (ownerWindow) => unlockCustomAgents(app, ownerWindow) } : undefined
      }
      setupLocked={
        setupProblem && {
          reason: agentSetupReason(name, setupProblem),
          setUp:
            setupProblem.kind === "coding_agent"
              ? {
                  label: `Set up ${backendRegistry[setupProblem.backendId].displayName}`,
                  open: () => onSetUp(setupProblem.backendId),
                }
              : undefined,
        }
      }
    />
  );
}

interface ProfileFacePickerProps {
  app: App;
  store: CustomAgentStore;
  agent: CustomAgent;
  onPick: (face: PickedFace) => void;
}

// Mounted only while the picker is open, so the preset faces download from the CDN only then.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/940
function ProfileFacePicker({ app, store, agent, onPick }: ProfileFacePickerProps) {
  const presets = usePresetFaces(app.vault, store);
  const [ownFace, setOwnFace] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    let mounted = true;
    readAgentFaces(app.vault, [agent]).then(
      ([bytes]) => mounted && setOwnFace(bytes ?? null),
      (error: unknown) => logError(`[Custom agents] Could not read ${agent.facePath}`, error)
    );
    return () => {
      mounted = false;
    };
  }, [app, agent]);
  const [selectedPresetId] =
    presets.status === "ready" && ownFace ? findUsedPresetIds(presets.faces, [ownFace]) : [];
  return <AgentFacePicker presets={presets} selectedPresetId={selectedPresetId} onPick={onPick} />;
}
