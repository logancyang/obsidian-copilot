import {
  getChainType,
  isProjectMode,
  ProjectConfig,
  setProjectLoading,
  subscribeToChainTypeChange,
  subscribeToModelKeyChange,
  subscribeToProjectChange,
} from "@/aiParams";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { ChainType } from "@/chainFactory";
import { updateChatMemory } from "@/chatUtils";
import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE, VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { logError, logInfo } from "@/logger";
import CopilotPlugin from "@/main";
import { Mention } from "@/mentions/Mention";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { err2String } from "@/utils";
import { App, Notice } from "obsidian";
import VectorStoreManager from "../search/vectorStoreManager";
import { BrevilabsClient } from "./brevilabsClient";
import ChainManager from "./chainManager";

export default class ProjectManager {
  public static instance: ProjectManager;
  private currentProjectId: string | null;
  private app: App;
  private plugin: CopilotPlugin;
  private readonly chainMangerInstance: ChainManager;
  private readonly projectContextCache: ProjectContextCache;
  private chatMessageCache: Map<string, ChatMessage[]>;
  private defaultProjectKey: string = "defaultProjectKey";

  private constructor(app: App, vectorStoreManager: VectorStoreManager, plugin: CopilotPlugin) {
    this.app = app;
    this.plugin = plugin;
    this.currentProjectId = null;
    this.chainMangerInstance = new ChainManager(app, vectorStoreManager);
    this.projectContextCache = ProjectContextCache.getInstance();
    this.chatMessageCache = new Map();

    // Set up subscriptions
    subscribeToModelKeyChange(async () => {
      await this.getCurrentChainManager().createChainWithNewModel();
    });

    subscribeToChainTypeChange(async () => {
      // When switching from other modes to project mode, no need to update the chain.
      if (isProjectMode()) {
        return;
      }
      await this.getCurrentChainManager().createChainWithNewModel({
        refreshIndex:
          getSettings().indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH &&
          (getChainType() === ChainType.VAULT_QA_CHAIN ||
            getChainType() === ChainType.COPILOT_PLUS_CHAIN),
      });
    });

    // Subscribe to Project changes
    subscribeToProjectChange(async (project) => {
      await this.switchProject(project);
    });

    // Subscribe to settings changes to monitor projectList changes
    this.setupProjectListChangeMonitor();
  }

  private setupProjectListChangeMonitor() {
    subscribeToSettingsChange(async (prev, next) => {
      if (!prev || !next) return;

      const prevProjects = prev.projectList || [];
      const nextProjects = next.projectList || [];

      // Find modified projects
      for (const nextProject of nextProjects) {
        const prevProject = prevProjects.find((p) => p.id === nextProject.id);
        if (prevProject) {
          // Check if project configuration has changed
          if (JSON.stringify(prevProject) !== JSON.stringify(nextProject)) {
            // Clear context cache for this project
            await this.projectContextCache.clearForProject(prevProject);

            // If this is the current project, reload its context and recreate chain
            if (this.currentProjectId === nextProject.id) {
              await Promise.all([
                this.loadProjectContext(nextProject),
                // Recreate chain to pick up new system prompt
                this.getCurrentChainManager().createChainWithNewModel(),
              ]);
            }
          }
        }
      }
    });
  }

  public static getInstance(
    app: App,
    vectorStoreManager: VectorStoreManager,
    plugin: CopilotPlugin
  ): ProjectManager {
    if (!ProjectManager.instance) {
      ProjectManager.instance = new ProjectManager(app, vectorStoreManager, plugin);
    }
    return ProjectManager.instance;
  }

  public getCurrentChainManager(): ChainManager {
    return this.chainMangerInstance;
  }

  public async switchProject(project: ProjectConfig | null): Promise<void> {
    try {
      setProjectLoading(true);

      // 1. save current project message. 2. load next project message

      // switch default project
      if (!project) {
        await this.saveCurrentProjectMessage();
        this.currentProjectId = null; // ensure set currentProjectId

        await this.loadNextProjectMessage();
        this.refreshChatView();
        return;
      }

      // else
      const projectId = project.id;
      if (this.currentProjectId === projectId) {
        return;
      }

      await this.saveCurrentProjectMessage();
      this.currentProjectId = projectId; // ensure set currentProjectId

      await Promise.all([
        // load memory
        this.loadNextProjectMessage(),
        // update chat model
        this.getCurrentChainManager().createChainWithNewModel(),
        // load context
        this.loadProjectContext(project),
      ]);

      // fresh chat view
      this.refreshChatView();

      logInfo(`Switched to project: ${project.name}`);
    } catch (error) {
      logError(`Failed to switch project: ${error}`);
      throw error;
    } finally {
      setProjectLoading(false);
    }
  }

  private async saveCurrentProjectMessage() {
    // save show message
    this.chatMessageCache.set(
      this.currentProjectId ? this.currentProjectId : this.defaultProjectKey,
      this.getCurrentChainManager().getChatMessages()
    );

    // TODO(emt-lin): do this or not?
    await this.plugin.autosaveCurrentChat();
  }

  private async loadNextProjectMessage() {
    const chainManager = this.getCurrentChainManager();

    const messages =
      this.chatMessageCache.get(
        this.currentProjectId ? this.currentProjectId : this.defaultProjectKey
      ) ?? [];

    chainManager.setChatMessages(messages);
    await updateChatMemory(messages, chainManager.memoryManager);
  }

  // TODO(logan): This should be reused as a generic context loading function
  private async loadProjectContext(project: ProjectConfig): Promise<void> {
    try {
      if (project.contextSource) {
        // Try to get context from cache first
        const cachedContext = await this.projectContextCache.get(project);
        if (cachedContext) {
          return;
        }

        const [markdownContext, webContext, youtubeContext] = await Promise.all([
          this.processMarkdownContext(
            project.contextSource.inclusions,
            project.contextSource.exclusions
          ),
          this.processWebUrlsContext(project.contextSource.webUrls),
          this.processYoutubeUrlsContext(project.contextSource.youtubeUrls),
        ]);

        // Build context sections only for non-null sources
        const contextParts = [];

        if (project.contextSource.inclusions || project.contextSource.exclusions) {
          contextParts.push(`## Markdown Files\n${markdownContext}`);
        }

        if (project.contextSource.webUrls?.trim()) {
          contextParts.push(`## Web Content\n${webContext}`);
        }

        if (project.contextSource.youtubeUrls?.trim()) {
          contextParts.push(`## YouTube Content\n${youtubeContext}`);
        }

        const contextText = `
# Project Context
The following information is the relevant context for this project. Use this information to inform your responses when appropriate:

<ProjectContext>
${contextParts.join("\n\n")}
</ProjectContext>
`;

        // Cache the generated context
        await this.projectContextCache.set(project, contextText);
      }
    } catch (error) {
      logError(`Failed to load project context: ${error}`);
      throw error;
    }
  }

  private refreshChatView() {
    // get chat view
    const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
    if (chatView) {
      chatView.updateView();
    }
  }

  public getProjectContext(projectId: string): string | null {
    const project = getSettings().projectList.find((p) => p.id === projectId);
    if (!project) {
      return null;
    }
    return this.projectContextCache.getSync(project);
  }

  public async clearContextCache(projectId: string): Promise<void> {
    const project = getSettings().projectList.find((p) => p.id === projectId);
    if (project) {
      await this.projectContextCache.clearForProject(project);
      logInfo(`Context cache cleared for project: ${projectId}`);
    }
  }

  private async processMarkdownContext(inclusions?: string, exclusions?: string): Promise<string> {
    if (!inclusions && !exclusions) {
      return "";
    }

    // NOTE: Must not fallback to GLOBAL inclusions and exclusions in Copilot settings in Projects!
    // This is to avoid project inclusions in the project that conflict with the global ones
    // Project UI should be the ONLY source of truth for project inclusions and exclusions
    const { inclusions: inclusionPatterns, exclusions: exclusionPatterns } = getMatchingPatterns({
      inclusions,
      exclusions,
      isProject: true,
    });

    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      return shouldIndexFile(file, inclusionPatterns, exclusionPatterns);
    });

    // Process each file with its metadata
    const processedNotes = await Promise.all(
      files.map(async (file) => {
        const content = await this.app.vault.cachedRead(file);
        const stat = await this.app.vault.adapter.stat(file.path);

        // Format the note with metadata
        return `[[${file.basename}]]
path: ${file.path}
created: ${stat ? new Date(stat.ctime).toISOString() : "unknown"}
modified: ${stat ? new Date(stat.mtime).toISOString() : "unknown"}

${content}`;
      })
    );

    // Join all processed notes with double newlines
    return processedNotes.join("\n\n");
  }

  private async processWebUrlsContext(webUrls?: string): Promise<string> {
    if (!webUrls?.trim()) {
      return "";
    }

    try {
      const mention = Mention.getInstance();
      const { urlContext } = await mention.processUrls(webUrls);
      return urlContext || "";
    } catch (error) {
      logError(`Failed to process web URLs: ${error}`);
      new Notice(`Failed to process web URLs: ${err2String(error)}`);
      return "";
    }
  }

  private async processYoutubeUrlsContext(youtubeUrls?: string): Promise<string> {
    if (!youtubeUrls?.trim()) {
      return "";
    }

    const urls = youtubeUrls.split("\n").filter((url) => url.trim());
    const processPromises = urls.map(async (url) => {
      try {
        const response = await BrevilabsClient.getInstance().youtube4llm(url);
        if (response.response.transcript) {
          return `\n\nYouTube transcript from ${url}:\n${response.response.transcript}`;
        }
        return "";
      } catch (error) {
        logError(`Failed to process YouTube URL ${url}: ${error}`);
        new Notice(`Failed to process YouTube URL ${url}: ${err2String(error)}`);
        return "";
      }
    });

    const results = await Promise.all(processPromises);
    return results.join("");
  }
}
