import type { CustomAgent } from "@/agents/CustomAgentStore";
import { logWarn } from "@/logger";
import { requestUrl, TFile, type Vault } from "obsidian";

const CDN = "https://images.brevilabs.com/";
export const PRESET_FACES_URL = `${CDN}newsletters/copilot-plugin/agent-faces/faces.json`;
const MAX_PRESET_FACES = 24;
const MAX_FACE_BYTES = 256 * 1024;

export interface PresetFace {
  id: string;
  alt: string;
  bytes: ArrayBuffer;
}

interface PresetFaceEntry {
  id: string;
  alt: string;
  url: string;
}

function parseFaceList(list: unknown): PresetFaceEntry[] {
  const faces = (list as { faces?: unknown } | null)?.faces;
  if (!Array.isArray(faces)) throw new Error("The preset face list has no faces.");
  // The list is remote data: only faces on the Brevilabs CDN are fetched, and only a grid's worth.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  return faces
    .flatMap((face: Partial<Record<keyof PresetFaceEntry, unknown>>) =>
      typeof face?.id === "string" && typeof face.url === "string" && face.url.startsWith(CDN)
        ? [{ id: face.id, alt: typeof face.alt === "string" ? face.alt : "", url: face.url }]
        : []
    )
    .slice(0, MAX_PRESET_FACES);
}

// A picked preset is saved as the agent's face.webp byte for byte, so anything but a small WebP is left out.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/939
function isSmallWebp(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_FACE_BYTES) return false;
  const header = String.fromCharCode(...new Uint8Array(bytes, 0, 12));
  return header.startsWith("RIFF") && header.endsWith("WEBP");
}

export async function loadPresetFaces(limit = MAX_PRESET_FACES): Promise<PresetFace[]> {
  const entries = parseFaceList((await requestUrl({ url: PRESET_FACES_URL })).json).slice(0, limit);
  const faces = await Promise.all(
    entries.map(async ({ id, alt, url }) => {
      try {
        const bytes = (await requestUrl({ url })).arrayBuffer;
        if (!isSmallWebp(bytes)) throw new Error("Not a WebP image of at most 256 KB.");
        return { id, alt, bytes };
      } catch (error) {
        // One face that fails to download leaves the rest of the grid usable.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
        logWarn(`[Custom agents] Could not download the preset face ${id}`, error);
        return null;
      }
    })
  );
  const loaded = faces.filter((face): face is PresetFace => face !== null);
  if (loaded.length === 0) throw new Error("No preset face could load.");
  return loaded;
}

export async function readAgentFaces(
  vault: Vault,
  agents: readonly Pick<CustomAgent, "facePath">[]
): Promise<ArrayBuffer[]> {
  const files = agents
    .map((agent) => vault.getAbstractFileByPath(agent.facePath))
    .filter((file): file is TFile => file instanceof TFile);
  return Promise.all(files.map((file) => vault.readBinary(file)));
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.every((byte, index) => byte === right[index]);
}

// A picked preset is saved byte for byte, so an agent's face file equal to a preset means that preset is in use.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/939
export function findUsedPresetIds(
  presets: readonly PresetFace[],
  agentFaces: readonly ArrayBuffer[]
): Set<string> {
  return new Set(
    presets
      .filter((preset) => agentFaces.some((face) => sameBytes(face, preset.bytes)))
      .map((preset) => preset.id)
  );
}
