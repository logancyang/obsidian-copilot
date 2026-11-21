import type { ModelSelection } from "@/agentMode";
import { logWarn } from "@/logger";
import { getFrontMatterInfo, parseYaml, stringifyYaml } from "obsidian";

export const INSTRUCTIONS_FILE_NAME = "instructions.md";
export const MEMORY_FILE_NAME = "MEMORY.md";
export const FACE_FILE_NAME = "face.webp";
export const FACE_SIZE_PX = 256;

const FACE_MIME = "image/webp";
const FACE_QUALITY = 0.9;
const MAX_SLUG_LENGTH = 48;
const FALLBACK_SLUG = "teammate";
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

const NEUTRAL_FACE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" fill="#9ca3af"/>' +
  '<circle cx="32" cy="26" r="11" fill="#e5e7eb"/>' +
  '<path d="M12 64c0-12 9-20 20-20s20 8 20 20z" fill="#e5e7eb"/></svg>';

export const NEUTRAL_FACE_SRC = `data:image/svg+xml,${encodeURIComponent(NEUTRAL_FACE_SVG)}`;

export interface CustomAgentProfile {
  name: string;
  title: string;
  model: ModelSelection | null;
}

export interface InstructionsFile extends CustomAgentProfile {
  instruction: string;
}

export function deriveAgentSlug(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const stem =
    Array.from(words).slice(0, MAX_SLUG_LENGTH).join("").replace(/-+$/, "") || FALLBACK_SLUG;
  // Windows cannot create a folder named after a device, so an agent named Aux or Com1 could not be created there.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/936
  return WINDOWS_DEVICE_NAME.test(stem) ? `${stem}-${FALLBACK_SLUG}` : stem;
}

export function findAgentNamed<T extends Pick<CustomAgentProfile, "name">>(
  agents: readonly T[],
  name: string
): T | undefined {
  const wanted = name.trim().toLocaleLowerCase();
  return agents.find((agent) => agent.name.trim().toLocaleLowerCase() === wanted);
}

export function findAgentNameConflict(
  agents: readonly (Pick<CustomAgentProfile, "name"> & { slug: string })[],
  folderNames: readonly string[],
  name: string
): string | null {
  const sameName = findAgentNamed(agents, name);
  if (sameName) return `${sameName.name} is already on your team. Pick another name.`;
  // A rename keeps the folder and two names can share one, so a new name can still need a folder that is taken.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/936
  const folder = deriveAgentSlug(name);
  if (!folderNames.some((taken) => taken.toLowerCase() === folder)) return null;
  const owner = agents.find((agent) => agent.slug.toLowerCase() === folder);
  return owner
    ? `${owner.name} already uses the folder ${folder}. Pick another name.`
    : `A folder named ${folder} already exists in your teammates folder. Pick another name.`;
}

export function serializeInstructionsFile(
  profile: CustomAgentProfile,
  instruction: string
): string {
  const frontmatter = {
    name: profile.name,
    title: profile.title,
    face: FACE_FILE_NAME,
    model: serializeModel(profile.model),
  };
  return `---\n${stringifyYaml(frontmatter)}---\n${instruction}`;
}

export function serializeModel(model: ModelSelection | null): string {
  return model ? JSON.stringify(model) : "";
}

export function parseInstructionsFile(content: string): InstructionsFile {
  const info = getFrontMatterInfo(content);
  const properties = info.exists ? parseProperties(info.frontmatter) : {};
  return {
    name: readString(properties.name),
    title: readString(properties.title),
    model: parseModel(properties.model),
    instruction: content.slice(info.contentStart),
  };
}

function parseProperties(frontmatter: string): Record<string, unknown> {
  try {
    const parsed: unknown = parseYaml(frontmatter);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    // A hand edit can break the YAML; the agent stays listed under its folder name instead of vanishing.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/936
    logWarn("[Custom agents] instructions.md has frontmatter that is not valid YAML.", error);
    return {};
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseModel(value: unknown): ModelSelection | null {
  try {
    const { baseModelId, effort } = JSON.parse(readString(value)) as Record<string, unknown>;
    if (typeof baseModelId !== "string" || !baseModelId) return null;
    return { baseModelId, effort: typeof effort === "string" ? effort : null };
  } catch {
    return null;
  }
}

export type FaceImage = { kind: "preset"; bytes: ArrayBuffer } | { kind: "upload"; image: Blob };

export async function encodeFace(face: FaceImage): Promise<ArrayBuffer> {
  return face.kind === "preset" ? face.bytes : await resizeUpload(face.image);
}

async function resizeUpload(image: Blob): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(image);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = createEl("canvas");
    canvas.width = FACE_SIZE_PX;
    canvas.height = FACE_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not encode the image.");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      FACE_SIZE_PX,
      FACE_SIZE_PX
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, FACE_MIME, FACE_QUALITY)
    );
    if (!blob) throw new Error("Could not encode the image.");
    return await blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}
