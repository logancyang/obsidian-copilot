import {
  OPENARTIFACTS_AGENT_HANDOFF_DIR,
  OPENARTIFACTS_MAX_HTML_BYTES,
  OPENARTIFACTS_VAULT_FOLDER,
} from "@/openArtifacts/constants";
import { requireNodeModule } from "@/utils/desktopRuntime";

/** Signals that a filesystem-backed agent handoff cannot be consumed safely. */
class OpenArtifactsAgentHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenArtifactsAgentHandoffError";
    Object.setPrototypeOf(this, OpenArtifactsAgentHandoffError.prototype);
  }
}

const UNSAFE_ROOT_MESSAGE =
  "The OpenArtifacts handoff folder must be an ordinary directory inside the current vault.";
const UNSAFE_FILE_MESSAGE =
  "Staged OpenArtifacts HTML must be one ordinary .html file inside the vault handoff folder.";
const CLEANUP_FAILED_MESSAGE = "Copilot could not remove the staged OpenArtifacts HTML.";
const PREVIEW_FOLDER_PREFIX = "copilot-openartifacts-preview-";
const PREVIEW_FILE_NAME = "preview.html";
/** Owns the temporary browser preview created from one consumed agent handoff. */
export interface OpenArtifactsAgentHandoff {
  readonly html: string;
  readonly previewPath: string;
  readonly previewUrl: string;
  readonly isPreviewCurrent: () => Promise<boolean>;
  readonly cleanup: () => Promise<void>;
}

function getDirectHandoffName(stagedHtmlPath: string): string {
  const prefix = `${OPENARTIFACTS_AGENT_HANDOFF_DIR}/`;
  const fileName = stagedHtmlPath.startsWith(prefix) ? stagedHtmlPath.slice(prefix.length) : "";
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    !fileName.toLowerCase().endsWith(".html")
  ) {
    throw new OpenArtifactsAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }
  return fileName;
}

async function getHandoffRoot(vaultRootAbs: string): Promise<string> {
  const { lstat } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const openArtifactsRoot = path.resolve(vaultRootAbs, OPENARTIFACTS_VAULT_FOLDER);
  const handoffRoot = path.join(openArtifactsRoot, "handoffs");
  try {
    const [openArtifactsStats, handoffStats] = await Promise.all([
      lstat(openArtifactsRoot),
      lstat(handoffRoot),
    ]);
    if (!openArtifactsStats.isDirectory() || !handoffStats.isDirectory()) {
      throw new Error("unsafe handoff root");
    }
  } catch {
    throw new OpenArtifactsAgentHandoffError(UNSAFE_ROOT_MESSAGE);
  }
  return handoffRoot;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new OpenArtifactsAgentHandoffError("Staged OpenArtifacts HTML must be valid UTF-8.");
  }
}

async function removeHandoff(stagedPath: string): Promise<void> {
  const { unlink } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  try {
    await unlink(stagedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new OpenArtifactsAgentHandoffError(CLEANUP_FAILED_MESSAGE);
    }
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createBrowserPreview(html: string): string {
  // The opaque-origin sandbox isolates page scripts from the local review shell.
  // Do not filter the page or its resources: the published HTML remains unchanged.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>OpenArtifacts local preview</title>
<style>html,body,iframe{border:0;height:100%;margin:0;padding:0;width:100%}body{overflow:hidden}iframe{display:block}</style>
</head>
<body>
<iframe title="OpenArtifacts HTML preview" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeHtmlAttribute(html)}"></iframe>
</body>
</html>
`;
}

async function createLocalPreview(html: string): Promise<OpenArtifactsAgentHandoff> {
  const { lstat, mkdtemp, readFile, rm, writeFile } =
    requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const { tmpdir } = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const { pathToFileURL } = requireNodeModule<typeof import("node:url")>("url");
  const previewRoot = await mkdtemp(path.join(tmpdir(), PREVIEW_FOLDER_PREFIX));
  const previewPath = path.join(previewRoot, PREVIEW_FILE_NAME);
  const browserPreview = createBrowserPreview(html);
  try {
    await writeFile(previewPath, new TextEncoder().encode(browserPreview), {
      flag: "wx",
      mode: 0o400,
    });
  } catch (error) {
    await rm(previewRoot, { recursive: true, force: true });
    throw error;
  }

  return Object.freeze({
    html,
    previewPath,
    previewUrl: pathToFileURL(previewPath).href,
    isPreviewCurrent: async () => {
      try {
        const stats = await lstat(previewPath);
        if (!stats.isFile()) return false;
        return decodeUtf8(Uint8Array.from(await readFile(previewPath))) === browserPreview;
      } catch {
        return false;
      }
    },
    cleanup: () => rm(previewRoot, { recursive: true, force: true }),
  });
}

/**
 * Consumes one bounded handoff before review and exposes the captured bytes through a
 * temporary local file whose lifecycle stays independent of agent-controlled storage.
 *
 * @param vaultRootAbs The absolute desktop vault root that owns the handoff.
 * @param stagedHtmlPath The normalized vault-relative staged HTML path.
 */
export async function consumeOpenArtifactsAgentHandoff(
  vaultRootAbs: string,
  stagedHtmlPath: string
): Promise<OpenArtifactsAgentHandoff> {
  const { lstat, readFile } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fileName = getDirectHandoffName(stagedHtmlPath);
  const handoffRoot = await getHandoffRoot(vaultRootAbs);
  const stagedPath = path.join(handoffRoot, fileName);

  let html: string;
  try {
    const stats = await lstat(stagedPath);
    if (!stats.isFile()) {
      throw new OpenArtifactsAgentHandoffError(UNSAFE_FILE_MESSAGE);
    }
    if (stats.size > OPENARTIFACTS_MAX_HTML_BYTES) {
      throw new OpenArtifactsAgentHandoffError(
        `OpenArtifacts HTML is ${stats.size} bytes; the limit is ${OPENARTIFACTS_MAX_HTML_BYTES} bytes.`
      );
    }

    const bytes = await readFile(stagedPath);
    if (bytes.byteLength > OPENARTIFACTS_MAX_HTML_BYTES) {
      throw new OpenArtifactsAgentHandoffError(
        `OpenArtifacts HTML is ${bytes.byteLength} bytes; the limit is ${OPENARTIFACTS_MAX_HTML_BYTES} bytes.`
      );
    }
    html = decodeUtf8(Uint8Array.from(bytes));
  } catch (error) {
    await removeHandoff(stagedPath);
    if (error instanceof OpenArtifactsAgentHandoffError) throw error;
    throw new OpenArtifactsAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }

  await removeHandoff(stagedPath);
  return createLocalPreview(html);
}
