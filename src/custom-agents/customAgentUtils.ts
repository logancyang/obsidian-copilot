import { AGENT_FRONTMATTER_KEYS, CustomAgent } from "./type";
import { getSettings } from "@/settings/model";
import { logInfo, logWarn } from "@/logger";
import { TFile } from "obsidian";

const DEFAULT_AGENTS_FOLDER = "copilot/agents";

/**
 * Get the agents folder path from settings.
 */
export function getAgentsFolder(): string {
  return getSettings().customAgentsFolder || DEFAULT_AGENTS_FOLDER;
}

/**
 * Check if a file is a custom agent file (in the agents folder).
 */
export function isAgentFile(file: TFile): boolean {
  const folder = getAgentsFolder();
  return file.path.startsWith(folder + "/") && file.extension === "md";
}

/**
 * Parse a custom agent from a vault file.
 */
export async function parseAgentFile(file: TFile): Promise<CustomAgent | null> {
  try {
    const vault = app.vault;
    const rawContent = await vault.read(file);
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    // Extract body content (after frontmatter)
    let content = rawContent;
    if (frontmatter?.position) {
      content = rawContent.substring(frontmatter.position.end.offset).trim();
    }

    return {
      title: file.basename,
      content,
      description: frontmatter?.[AGENT_FRONTMATTER_KEYS.DESCRIPTION] || "",
      icon: frontmatter?.[AGENT_FRONTMATTER_KEYS.ICON] || "bot",
      modelKey: frontmatter?.[AGENT_FRONTMATTER_KEYS.MODEL_KEY] || "",
      tools: frontmatter?.[AGENT_FRONTMATTER_KEYS.TOOLS] || [],
      enabled: frontmatter?.[AGENT_FRONTMATTER_KEYS.ENABLED] !== false,
      order: frontmatter?.[AGENT_FRONTMATTER_KEYS.ORDER] || 0,
      createdMs: frontmatter?.[AGENT_FRONTMATTER_KEYS.CREATED] || file.stat.ctime,
      modifiedMs: frontmatter?.[AGENT_FRONTMATTER_KEYS.MODIFIED] || file.stat.mtime,
      lastUsedMs: frontmatter?.[AGENT_FRONTMATTER_KEYS.LAST_USED] || 0,
    };
  } catch (error) {
    logWarn(`Failed to parse agent file ${file.path}:`, error);
    return null;
  }
}

/**
 * Load all custom agents from the agents folder.
 */
export async function loadAllCustomAgents(): Promise<CustomAgent[]> {
  const folder = getAgentsFolder();
  const vault = app.vault;

  // Ensure folder exists
  const folderExists = vault.getAbstractFileByPath(folder);
  if (!folderExists) {
    return [];
  }

  const files = vault.getFiles().filter((f) => isAgentFile(f));
  const agents: CustomAgent[] = [];

  for (const file of files) {
    const agent = await parseAgentFile(file);
    if (agent && agent.enabled) {
      agents.push(agent);
    }
  }

  // Sort by order, then by title
  agents.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  logInfo(`[CustomAgents] Loaded ${agents.length} agents from ${folder}`);
  return agents;
}

/**
 * Create a new custom agent file in the vault.
 */
export async function createAgentFile(agent: CustomAgent): Promise<void> {
  const folder = getAgentsFolder();
  const vault = app.vault;

  // Ensure folder exists
  const folderExists = vault.getAbstractFileByPath(folder);
  if (!folderExists) {
    await vault.createFolder(folder);
  }

  const path = `${folder}/${agent.title}.md`;
  const frontmatter = buildAgentFrontmatter(agent);
  const fileContent = `---\n${frontmatter}---\n${agent.content}`;

  await vault.create(path, fileContent);
  logInfo(`[CustomAgents] Created agent file: ${path}`);
}

/**
 * Update an existing agent file's frontmatter (e.g., to record usage).
 */
export async function updateAgentFrontmatter(
  agent: CustomAgent,
  updates: Partial<CustomAgent>
): Promise<void> {
  const folder = getAgentsFolder();
  const path = `${folder}/${agent.title}.md`;
  const vault = app.vault;
  const file = vault.getAbstractFileByPath(path);

  if (!file || !("extension" in file)) {
    logWarn(`[CustomAgents] Agent file not found for update: ${path}`);
    return;
  }

  const rawContent = await vault.read(file as TFile);
  const updatedAgent = { ...agent, ...updates };
  const frontmatter = buildAgentFrontmatter(updatedAgent);

  // Replace frontmatter
  const bodyStart = rawContent.indexOf("---", 3);
  const body = bodyStart >= 0 ? rawContent.substring(bodyStart + 3).trim() : agent.content;
  const newContent = `---\n${frontmatter}---\n${body}`;

  await vault.modify(file as TFile, newContent);
}

/**
 * Build YAML frontmatter string from agent definition.
 */
function buildAgentFrontmatter(agent: CustomAgent): string {
  const lines: string[] = [];
  lines.push(`${AGENT_FRONTMATTER_KEYS.DESCRIPTION}: "${agent.description.replace(/"/g, '\\"')}"`);
  lines.push(`${AGENT_FRONTMATTER_KEYS.ICON}: "${agent.icon}"`);
  lines.push(`${AGENT_FRONTMATTER_KEYS.MODEL_KEY}: "${agent.modelKey}"`);
  lines.push(`${AGENT_FRONTMATTER_KEYS.TOOLS}: [${agent.tools.map((t) => `"${t}"`).join(", ")}]`);
  lines.push(`${AGENT_FRONTMATTER_KEYS.ENABLED}: ${agent.enabled}`);
  lines.push(`${AGENT_FRONTMATTER_KEYS.ORDER}: ${agent.order}`);
  lines.push(`${AGENT_FRONTMATTER_KEYS.CREATED}: ${agent.createdMs}`);
  lines.push(`${AGENT_FRONTMATTER_KEYS.MODIFIED}: ${Date.now()}`);
  lines.push(`${AGENT_FRONTMATTER_KEYS.LAST_USED}: ${agent.lastUsedMs}`);
  return lines.join("\n") + "\n";
}

/**
 * Get a list of built-in starter agents to create when the folder is first initialized.
 */
export function getStarterAgents(): CustomAgent[] {
  const now = Date.now();
  return [
    {
      title: "Research Assistant",
      content: `You are a research assistant specialized in finding and synthesizing information.

When the user asks about a topic:
1. Search the vault first using localSearch to find existing notes
2. If needed, search the web for additional information
3. Synthesize findings into a clear, well-organized response
4. Cite sources using [[Note Title]] for vault notes and footnotes for web sources
5. Suggest creating a new note to save important findings

Be thorough but concise. Focus on accuracy and proper attribution.`,
      description: "Finds and synthesizes information from your vault and the web",
      icon: "search",
      modelKey: "",
      tools: ["localSearch", "webSearch", "readNote", "filterNotes"],
      enabled: true,
      order: 10,
      createdMs: now,
      modifiedMs: now,
      lastUsedMs: 0,
    },
    {
      title: "Writing Coach",
      content: `You are a writing coach that helps improve and create written content.

Guidelines:
- When asked to review writing, provide specific, actionable feedback
- Focus on clarity, structure, flow, and tone
- Preserve the author's voice while suggesting improvements
- Use Obsidian callouts for different types of feedback:
  - > [!tip] for suggestions
  - > [!warning] for issues to address
  - > [!example] for alternative phrasings
- When creating new content, match the style of existing notes in the vault`,
      description: "Helps improve writing with specific, actionable feedback",
      icon: "pen-tool",
      modelKey: "",
      tools: ["localSearch", "readNote", "appendToNote", "editFile"],
      enabled: true,
      order: 20,
      createdMs: now,
      modifiedMs: now,
      lastUsedMs: 0,
    },
    {
      title: "Vault Organizer",
      content: `You are a vault organization assistant that helps users structure and maintain their Obsidian vault.

When asked to help organize:
1. Use filterNotes to survey the current state of notes
2. Use getTagList to understand the tagging system
3. Use getFileTree to understand the folder structure
4. Suggest improvements to organization (folders, tags, links)
5. Can rename/move notes and create directories as needed
6. Always explain your reasoning before making changes

Principles:
- Prefer flat structures with good linking over deep folder hierarchies
- Tags are for cross-cutting concerns, folders for primary categories
- Every note should be reachable via at least one link or tag`,
      description: "Helps organize notes, tags, and folder structure",
      icon: "folder-tree",
      modelKey: "",
      tools: [
        "localSearch",
        "filterNotes",
        "getFileTree",
        "getTagList",
        "readNote",
        "renameNote",
        "createDirectory",
      ],
      enabled: true,
      order: 30,
      createdMs: now,
      modifiedMs: now,
      lastUsedMs: 0,
    },
  ];
}
