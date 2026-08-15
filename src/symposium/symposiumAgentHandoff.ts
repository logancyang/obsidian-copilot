import { SYMPOSIUM_AGENT_HANDOFF_DIR, SYMPOSIUM_MAX_HTML_BYTES } from "@/symposium/constants";
import {
  SymposiumDocumentUnsafeError,
  validateSymposiumReviewHtml,
} from "@/symposium/symposiumDocument";
import { requireNodeModule } from "@/utils/desktopRuntime";

/** Signals that a filesystem-backed agent handoff cannot be consumed safely. */
class SymposiumAgentHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SymposiumAgentHandoffError";
    Object.setPrototypeOf(this, SymposiumAgentHandoffError.prototype);
  }
}

const UNSAFE_ROOT_MESSAGE =
  "The Symposium handoff folder must be an ordinary directory inside the current vault.";
const UNSAFE_FILE_MESSAGE =
  "Staged Symposium HTML must be one ordinary .html file inside the vault handoff folder.";
const CLEANUP_FAILED_MESSAGE = "Copilot could not remove the staged Symposium HTML.";
const PREVIEW_FOLDER_PREFIX = "copilot-symposium-preview-";
const PREVIEW_FILE_NAME = "preview.html";
const PREVIEW_CONTENT_SECURITY_DIRECTIVES = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src data:",
  "form-action 'none'",
  "img-src data:",
  "media-src data:",
  "object-src 'none'",
  "style-src 'unsafe-inline'",
];

/** Owns the temporary browser preview created from one consumed agent handoff. */
export interface SymposiumAgentHandoff {
  readonly html: string;
  readonly previewPath: string;
  readonly previewUrl: string;
  readonly isPreviewCurrent: () => Promise<boolean>;
  readonly cleanup: () => Promise<void>;
}

function getDirectHandoffName(stagedHtmlPath: string): string {
  const prefix = `${SYMPOSIUM_AGENT_HANDOFF_DIR}/`;
  const fileName = stagedHtmlPath.startsWith(prefix) ? stagedHtmlPath.slice(prefix.length) : "";
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    !fileName.toLowerCase().endsWith(".html")
  ) {
    throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }
  return fileName;
}

async function getHandoffRoot(vaultRootAbs: string): Promise<string> {
  const { lstat } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const symposiumRoot = path.resolve(vaultRootAbs, ".symposium");
  const handoffRoot = path.join(symposiumRoot, "handoffs");
  try {
    const [symposiumStats, handoffStats] = await Promise.all([
      lstat(symposiumRoot),
      lstat(handoffRoot),
    ]);
    if (!symposiumStats.isDirectory() || !handoffStats.isDirectory()) {
      throw new Error("unsafe handoff root");
    }
  } catch {
    throw new SymposiumAgentHandoffError(UNSAFE_ROOT_MESSAGE);
  }
  return handoffRoot;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SymposiumAgentHandoffError("Staged Symposium HTML must be valid UTF-8.");
  }
}

async function removeHandoff(stagedPath: string): Promise<void> {
  const { unlink } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  try {
    await unlink(stagedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new SymposiumAgentHandoffError(CLEANUP_FAILED_MESSAGE);
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

function createContentSecurityPolicy(
  frameSource: "'none'" | "'self'",
  scriptSource: "'none'" | "'unsafe-inline'"
): string {
  return [
    ...PREVIEW_CONTENT_SECURITY_DIRECTIVES,
    `frame-src ${frameSource}`,
    `script-src ${scriptSource}`,
  ].join("; ");
}

function createBrowserPreview(html: string): string {
  const shellPolicy = createContentSecurityPolicy("'self'", "'unsafe-inline'");
  const contentPolicy = createContentSecurityPolicy("'none'", "'none'");
  const sandboxedContent = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(contentPolicy)}">${html}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(shellPolicy)}">
<meta name="referrer" content="no-referrer">
<title>Symposium local preview</title>
<style>html,body,iframe{border:0;height:100%;margin:0;padding:0;width:100%}body{overflow:hidden}iframe{display:block}</style>
</head>
<body>
<iframe title="Symposium HTML preview" sandbox="allow-same-origin" referrerpolicy="no-referrer" srcdoc="${escapeHtmlAttribute(sandboxedContent)}"></iframe>
<script>
const frame=document.querySelector("iframe");
const block=(event)=>event.preventDefault();
const seal=()=>{
  const previewDocument=frame.contentDocument;
  if(!previewDocument)return;
  for(const eventName of ["auxclick","click","contextmenu","dragstart","submit"]){
    previewDocument.addEventListener(eventName,block,true);
  }
};
frame.addEventListener("load",seal);
seal();
</script>
</body>
</html>
`;
}

async function createLocalPreview(html: string): Promise<SymposiumAgentHandoff> {
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
export async function consumeSymposiumAgentHandoff(
  vaultRootAbs: string,
  stagedHtmlPath: string
): Promise<SymposiumAgentHandoff> {
  const { lstat, readFile } = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fileName = getDirectHandoffName(stagedHtmlPath);
  const handoffRoot = await getHandoffRoot(vaultRootAbs);
  const stagedPath = path.join(handoffRoot, fileName);

  let html: string;
  try {
    const stats = await lstat(stagedPath);
    if (!stats.isFile()) {
      throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
    }
    if (stats.size > SYMPOSIUM_MAX_HTML_BYTES) {
      throw new SymposiumAgentHandoffError(
        `Symposium HTML is ${stats.size} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`
      );
    }

    const bytes = await readFile(stagedPath);
    if (bytes.byteLength > SYMPOSIUM_MAX_HTML_BYTES) {
      throw new SymposiumAgentHandoffError(
        `Symposium HTML is ${bytes.byteLength} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`
      );
    }
    html = decodeUtf8(Uint8Array.from(bytes));
  } catch (error) {
    await removeHandoff(stagedPath);
    if (error instanceof SymposiumAgentHandoffError) throw error;
    throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }

  try {
    validateSymposiumReviewHtml(html);
  } catch (error) {
    if (error instanceof SymposiumDocumentUnsafeError) {
      throw new SymposiumAgentHandoffError(
        `${error.message} Edit this staged file and retry once: ${stagedHtmlPath}`
      );
    }
    throw error;
  }

  await removeHandoff(stagedPath);
  return createLocalPreview(html);
}
