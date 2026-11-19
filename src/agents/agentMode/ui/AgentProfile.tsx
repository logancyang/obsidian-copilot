import {
  deleteAgentWithChats,
  listAgentChats,
  type DeleteAgentResult,
} from "@/agents/agentMode/agentChats";
import { openAgentFile } from "@/agents/agentMode/memorySaveCards";
import { useAgentProfileFacts } from "@/agents/agentMode/ui/useAgentProfileFacts";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { findUsedPresetIds, readAgentFaces } from "@/agents/presetFaces";
import { AgentDeleteModal } from "@/agents/ui/AgentDeleteModal";
import { AgentFacePicker, type PickedFace } from "@/agents/ui/AgentFacePicker";
import { AgentProfileView, countOf } from "@/agents/ui/AgentProfileView";
import type { AgentModelChoices } from "@/agents/ui/CreateAgentForm";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import { usePresetFaces } from "@/agents/ui/usePresetFaces";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { logError } from "@/logger";
import { Notice, type App } from "obsidian";
import React, { useEffect, useState } from "react";

export interface AgentProfileProps {
  agent: CustomAgent;
  app: App;
  manager: AgentSessionManager;
  store: CustomAgentStore;
  hostSessionId: string;
  getModels: () => AgentModelChoices;
  onBack: () => void;
  onNewChat: (agent: CustomAgent) => void;
}

export function agentDeleteNotice(
  name: string,
  { deletedChats, failedChats, agentDeleted }: DeleteAgentResult
): string {
  if (agentDeleted) {
    return `Deleted ${name}${deletedChats > 0 ? ` and ${countOf(deletedChats, "chat")}` : ""}.`;
  }
  if (failedChats > 0) {
    const all = countOf(deletedChats + failedChats, "chat");
    return `Couldn't delete ${failedChats} of ${name}'s ${all}, so ${name} was kept.`;
  }
  if (deletedChats > 0) {
    return `Deleted ${countOf(deletedChats, "chat")} with ${name}, but couldn't delete ${name}.`;
  }
  return `Couldn't delete ${name}.`;
}

export function AgentProfile({
  agent,
  app,
  manager,
  store,
  hostSessionId,
  getModels,
  onBack,
  onNewChat,
}: AgentProfileProps) {
  const facts = useAgentProfileFacts(app, manager, agent);
  const agents = useCustomAgents(store);
  const [models] = useState(getModels);
  const { slug, name } = agent;
  const failed = (change: string) => (error: unknown) => {
    logError(`[Custom agents] Changing ${slug}'s ${change} failed`, error);
    new Notice(`Couldn't change ${name}'s ${change}.`);
  };
  const confirmDelete = async () => {
    const chats = await listAgentChats(manager, slug);
    new AgentDeleteModal(
      app,
      { agent, memoryRules: facts.memory?.rules ?? null, chatCount: chats.length },
      () => void deleteAgent()
    ).open();
  };
  const deleteAgent = async () => {
    try {
      const result = await deleteAgentWithChats({ app, manager, store, slug, hostSessionId });
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
