import type { CustomAgentStore } from "@/agents/CustomAgentStore";
import {
  findUsedPresetIds,
  loadPresetFaces,
  readAgentFaces,
  type PresetFace,
} from "@/agents/presetFaces";
import { readAsDataUrl } from "@/agents/ui/AgentFacePicker";
import { logWarn } from "@/logger";
import type { Vault } from "obsidian";
import { useEffect, useState } from "react";

export interface PresetFaceChoice extends PresetFace {
  src: string;
}

export type PresetFacesState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; faces: readonly PresetFaceChoice[]; usedIds: ReadonlySet<string> };

const LOADING: PresetFacesState = Object.freeze({ status: "loading" });
const FAILED: PresetFacesState = Object.freeze({ status: "failed" });

export function usePresetFaces(vault: Vault, store: CustomAgentStore): PresetFacesState {
  const [state, setState] = useState(LOADING);

  useEffect(() => {
    let mounted = true;
    const load = async (): Promise<PresetFacesState> => {
      const faces = await loadPresetFaces();
      const [choices, agentFaces] = await Promise.all([
        Promise.all(
          faces.map(async (face) => ({
            ...face,
            src: await readAsDataUrl(new Blob([face.bytes], { type: "image/webp" })),
          }))
        ),
        readAgentFaces(vault, store.getAgents()),
      ]);
      return { status: "ready", faces: choices, usedIds: findUsedPresetIds(faces, agentFaces) };
    };
    void load()
      .catch((error: unknown) => {
        // Without the face list the picker still offers upload.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
        logWarn("[Custom agents] Could not load the preset faces", error);
        return FAILED;
      })
      .then((next) => {
        if (mounted) setState(next);
      });
    return () => {
      mounted = false;
    };
  }, [vault, store]);

  return state;
}
