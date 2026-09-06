import {
  OPENARTIFACTS_AGENT_HANDOFF_DIR,
  OPENARTIFACTS_MAX_HTML_BYTES,
  OPENARTIFACTS_VAULT_FOLDER,
} from "@/openArtifacts/constants";
import { requireNodeModule } from "@/utils/desktopRuntime";

/** Signals that a filesystem-backed agent handoff cannot be read safely. */
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
const PREVIEW_FOLDER_PREFIX = "copilot-openartifacts-preview-";
const PREVIEW_FILE_NAME = "preview.html";
/** Owns the temporary browser preview created from one captured agent handoff. */
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

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createBrowserPreview(html: string): string {
  // Preview-only isolation must not reject or rewrite the published document.
  // https://github.com/logancyang/obsidian-copilot/issues/3121
  const policy =
    "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; img-src data:; media-src data:; object-src 'none'; style-src 'unsafe-inline'";
  const contentPolicy = `${policy}; frame-src 'none'; script-src 'none'`;
  const source = JSON.stringify(html).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(`${policy}; frame-src 'self'; script-src 'unsafe-inline'`)}">
<meta name="referrer" content="no-referrer">
<title>OpenArtifacts local preview</title>
<style>html,body,iframe{border:0;height:100%;margin:0;padding:0;width:100%}body{overflow:hidden}iframe{display:block}</style>
</head>
<body>
<iframe title="OpenArtifacts HTML preview" sandbox="allow-same-origin" referrerpolicy="no-referrer" srcdoc="${escapeHtmlAttribute(`<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(contentPolicy)}"><body></body>`)}"></iframe>
<script>
const template = document.createElement("template");
template.innerHTML = ${source};
for (const element of template.content.querySelectorAll("*")) {
  if (["noscript", "script", "iframe", "frame", "object", "embed", "template", "meta", "base", "animate", "animatetransform", "animatemotion", "set"].includes(element.localName.toLowerCase())) { element.remove(); continue; }
  for (const attribute of Array.from(element.attributes)) {
    if (["href", "action", "formaction"].includes(attribute.localName.toLowerCase())) {
      element.removeAttributeNode(attribute);
    }
  }
}
const frame = document.querySelector("iframe");
frame.addEventListener("load", () => {
  frame.contentDocument.body.replaceChildren(template.content);
}, { once: true });
</script>
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
 * Reads one bounded handoff without deleting it and exposes the captured bytes through a
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
    if (error instanceof OpenArtifactsAgentHandoffError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new OpenArtifactsAgentHandoffError(
        `The staged HTML file was not found: ${stagedHtmlPath}. Regenerate the HTML before reopening review.`
      );
    }
    throw new OpenArtifactsAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }

  return createLocalPreview(html);
}
