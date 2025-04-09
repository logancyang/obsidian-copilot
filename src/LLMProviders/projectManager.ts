import {
  getChainType,
  isProjectMode,
  ProjectConfig,
  setProjectLoading,
  subscribeToChainTypeChange,
  subscribeToModelKeyChange,
  subscribeToProjectChange,
} from "@/aiParams";
import { ContextCache, ProjectContextCache } from "@/cache/projectContextCache";
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
            // Compare project configuration changes and selectively update cache
            await this.compareAndUpdateCache(prevProject, nextProject);

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
  private async loadProjectContext(project: ProjectConfig): Promise<ContextCache | null> {
    try {
      if (!project.contextSource) {
        return null;
      }

      const contextCache = (await this.projectContextCache.get(project)) || {
        markdownContext: "",
        webContexts: {},
        youtubeContexts: {},
        timestamp: Date.now(),
        markdownNeedsReload: false,
      };

      const [updatedContextCache] = await Promise.all([
        this.processMarkdownFiles(project, contextCache),
        this.processWebUrls(project, contextCache),
        this.processYoutubeUrls(project, contextCache),
      ]);

      updatedContextCache.timestamp = Date.now();
      await this.projectContextCache.set(project, updatedContextCache);
      return updatedContextCache;
    } catch (error) {
      logError(`Failed to load project context: ${error}`);
      throw error;
    }
  }

  private async compareAndUpdateCache(prevProject: ProjectConfig, nextProject: ProjectConfig) {
    try {
      const cache = await this.projectContextCache.get(prevProject);

      // If no cache exists, return true to create a new cache later
      if (!cache) {
        return true;
      }

      // Check if Markdown configuration has changed
      const prevInclusions = prevProject.contextSource?.inclusions || "";
      const nextInclusions = nextProject.contextSource?.inclusions || "";
      const prevExclusions = prevProject.contextSource?.exclusions || "";
      const nextExclusions = nextProject.contextSource?.exclusions || "";

      if (prevInclusions !== nextInclusions || prevExclusions !== nextExclusions) {
        // Markdown config changed, clear markdown context and mark for reload
        cache.markdownContext = "";
        cache.markdownNeedsReload = true;
        logInfo(
          `Markdown configuration changed for project ${nextProject.name}, marking for reload`
        );
      }

      // Check if Web URLs configuration has changed
      const prevWebUrls = prevProject.contextSource?.webUrls || "";
      const nextWebUrls = nextProject.contextSource?.webUrls || "";

      if (prevWebUrls !== nextWebUrls) {
        // Find removed URLs
        const prevUrls = prevWebUrls.split("\n").filter((url) => url.trim());
        const nextUrls = nextWebUrls.split("\n").filter((url) => url.trim());

        // Remove context for URLs that no longer exist
        for (const url of prevUrls) {
          if (!nextUrls.includes(url) && cache.webContexts[url]) {
            delete cache.webContexts[url];
            logInfo(`Removed web context for URL ${url} in project ${nextProject.name}`);
          }
        }
      }

      // Check if YouTube URLs configuration has changed
      const prevYoutubeUrls = prevProject.contextSource?.youtubeUrls || "";
      const nextYoutubeUrls = nextProject.contextSource?.youtubeUrls || "";

      if (prevYoutubeUrls !== nextYoutubeUrls) {
        // Find removed URLs
        const prevUrls = prevYoutubeUrls.split("\n").filter((url) => url.trim());
        const nextUrls = nextYoutubeUrls.split("\n").filter((url) => url.trim());

        // Remove context for URLs that no longer exist
        for (const url of prevUrls) {
          if (!nextUrls.includes(url) && cache.youtubeContexts[url]) {
            delete cache.youtubeContexts[url];
            logInfo(`Removed YouTube context for URL ${url} in project ${nextProject.name}`);
          }
        }
      }

      // Update cache if needed
      if (cache.markdownNeedsReload) {
        // Save updated cache with the new project ID
        await this.projectContextCache.set(nextProject, cache);
        logInfo(`Updated cache for project ${nextProject.name}`);
      }
    } catch (error) {
      logError(`Error comparing project configurations: ${error}`);
    }
  }

  private refreshChatView() {
    // get chat view
    const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
    if (chatView) {
      chatView.updateView();
    }
  }

  public async getProjectContext(projectId: string): Promise<string | null> {
    const project = getSettings().projectList.find((p) => p.id === projectId);
    if (!project) {
      return null;
    }

    const contextCache = this.projectContextCache.getSync(project);
    if (!contextCache) {
      return null;
    }

    if (contextCache.markdownNeedsReload) {
      const updatedCache = await this.loadProjectContext(project);
      if (!updatedCache) {
        return null;
      }
      return this.formatProjectContext(updatedCache);
    }

    return this.formatProjectContext(contextCache);
  }

  private formatProjectContext(contextCache: ContextCache): string {
    const contextParts = [];

    if (contextCache.markdownContext) {
      contextParts.push(`## Markdown Files\n${contextCache.markdownContext}`);
    }

    if (Object.keys(contextCache.webContexts).length > 0) {
      contextParts.push(`## Web Content\n${Object.values(contextCache.webContexts).join("\n\n")}`);
    }

    if (Object.keys(contextCache.youtubeContexts).length > 0) {
      contextParts.push(
        `## YouTube Content\n${Object.values(contextCache.youtubeContexts).join("\n\n")}`
      );
    }

    return `
# Project Context
The following information is the relevant context for this project. Use this information to inform your responses when appropriate:

<ProjectContext>
${contextParts.join("\n\n")}
</ProjectContext>
`;
  }

  private async processMarkdownFiles(
    project: ProjectConfig,
    contextCache: ContextCache
  ): Promise<ContextCache> {
    if (project.contextSource?.inclusions || project.contextSource?.exclusions) {
      // Only process if needsReload is true or there is no existing content
      if (contextCache.markdownNeedsReload || !contextCache.markdownContext.trim()) {
        const markdownContext = await this.processMarkdownContext(
          project.contextSource.inclusions,
          project.contextSource.exclusions
        );
        contextCache.markdownContext = markdownContext;
        contextCache.markdownNeedsReload = false; // reset flag
      }
    }
    return contextCache;
  }

  private async processWebUrls(
    project: ProjectConfig,
    contextCache: ContextCache
  ): Promise<ContextCache> {
    if (!project.contextSource?.webUrls?.trim()) {
      return contextCache;
    }

    const urls = project.contextSource.webUrls.split("\n").filter((url) => url.trim());
    const webContextPromises = urls.map(async (url) => {
      if (!contextCache.webContexts[url]) {
        const webContext = await this.processWebUrlsContext(url);
        return { url, context: webContext };
      }
      return null;
    });

    const results = await Promise.all(webContextPromises);
    results.forEach((result) => {
      if (result) {
        contextCache.webContexts[result.url] = result.context;
      }
    });

    return contextCache;
  }

  private async processYoutubeUrls(
    project: ProjectConfig,
    contextCache: ContextCache
  ): Promise<ContextCache> {
    if (!project.contextSource?.youtubeUrls?.trim()) {
      return contextCache;
    }

    const urls = project.contextSource.youtubeUrls.split("\n").filter((url) => url.trim());
    const youtubeContextPromises = urls.map(async (url) => {
      if (!contextCache.youtubeContexts[url]) {
        const youtubeContext = await this.processYoutubeUrlsContext(url);
        return { url, context: youtubeContext };
      }
      return null;
    });

    const results = await Promise.all(youtubeContextPromises);
    results.forEach((result) => {
      if (result) {
        contextCache.youtubeContexts[result.url] = result.context;
      }
    });

    return contextCache;
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

  public onunload(): void {
    this.projectContextCache.cleanup();
  }
}
