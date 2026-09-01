export const OPENARTIFACTS_API_ORIGIN = "https://api.openartifacts.ai";
export const OPENARTIFACTS_DOCUMENT_ORIGIN = "https://openartifacts.site";
export const OPENARTIFACTS_WORKSPACE_ROOT_ENV = "OPENARTIFACTS_WORKSPACE_ROOT";
export const OPENARTIFACTS_AGENT_BRIDGE_PROPERTY = "openArtifactsAgentBridge";
/** Hidden vault folder holding publication history, staged agent handoffs, and user themes. */
export const OPENARTIFACTS_VAULT_FOLDER = ".openartifacts";
export const OPENARTIFACTS_AGENT_HANDOFF_DIR = `${OPENARTIFACTS_VAULT_FOLDER}/handoffs`;
export const OPENARTIFACTS_THEMES_DIR = `${OPENARTIFACTS_VAULT_FOLDER}/themes`;
export const OPENARTIFACTS_DOC_ID_PATTERN = /^[0123456789abcdefghjkmnpqrstvwxyz]{16}$/;
export const OPENARTIFACTS_MAX_HTML_BYTES = 10 * 1024 * 1024;
