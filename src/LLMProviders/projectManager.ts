import {
  FailedItem,
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
import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE, VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import CopilotPlugin from "@/main";
import { Mention } from "@/mentions/Mention";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { FileParserManager } from "@/tools/FileParserManager";
import { err2String } from "@/utils";
import { isRateLimitError } from "@/utils/rateLimitUtils";
import { App, Notice, TFile } from "obsidian";
import { BrevilabsClient } from "./brevilabsClient";
import ChainManager from "./chainManager";
import { ProjectLoadTracker } from "./projectLoadTracker";

export default class ProjectManager {
  public static instance: ProjectManager;
  private currentProjectId: string | null;
  private app: App;
  private plugin: CopilotPlugin;
  private readonly chainMangerInstance: ChainManager;
  private readonly projectContextCache: ProjectContextCache;
  private fileParserManager: FileParserManager;
  private loadTracker: ProjectLoadTracker;

  private constructor(app: App, plugin: CopilotPlugin) {
    this.app = app;
    this.plugin = plugin;
    this.currentProjectId = null;
    this.chainMangerInstance = new ChainManager(app, plugin);
    this.projectContextCache = ProjectContextCache.getInstance();
    this.fileParserManager = new FileParserManager(
      BrevilabsClient.getInstance(),
      this.app.vault,
      true,
      null
    );
    this.loadTracker = ProjectLoadTracker.getInstance(this.app);

    // Set up subscriptions
    subscribeToModelKeyChange(async () => {
      await this.getCurrentChainManager().createChainWithNewModel();
    });

    subscribeToChainTypeChange(async () => {
      // When switching from other modes to project mode, no need to update the chain.
      if (isProjectMode()) {
        return;
      }
      const settings = getSettings();
      const shouldAutoIndex =
        settings.enableSemanticSearchV3 &&
        settings.indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH &&
        (getChainType() === ChainType.VAULT_QA_CHAIN ||
          getChainType() === ChainType.COPILOT_PLUS_CHAIN);
      await this.getCurrentChainManager().createChainWithNewModel({
        refreshIndex: shouldAutoIndex,
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

  public static getInstance(app: App, plugin: CopilotPlugin): ProjectManager {
    if (!ProjectManager.instance) {
      ProjectManager.instance = new ProjectManager(app, plugin);
    }
    return ProjectManager.instance;
  }

  public getCurrentChainManager(): ChainManager {
    return this.chainMangerInstance;
  }

  public getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }

  public async switchProject(project: ProjectConfig | null): Promise<void> {
    try {
      // Clear all project context loading states
      this.loadTracker.clearAllLoadStates();
      setProjectLoading(true);
      logInfo("Project loading started...");

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

      // Use sequential operations to ensure loading state is maintained
      // through the entire process
      await this.loadNextProjectMessage();
      await this.getCurrentChainManager().createChainWithNewModel();
      // Update FileParserManager with the current project
      this.fileParserManager = new FileParserManager(
        BrevilabsClient.getInstance(),
        this.app.vault,
        true,
        project
      );
      await this.loadProjectContext(project);

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
    // The new ChatManager handles message persistence internally
    // during project switches, so we just need to trigger autosave
    await this.plugin.autosaveCurrentChat();
  }

  private async loadNextProjectMessage() {
    // Notify ChatUIState about the project switch
    // This will trigger ChatManager to switch to the correct message repository
    // and update the UI with the appropriate messages
    await this.plugin.chatUIState.handleProjectSwitch();
  }

  private async loadProjectContext(project: ProjectConfig): Promise<ContextCache | null> {
    // for update context condition
    this.loadTracker.clearAllLoadStates();
    setProjectLoading(true);

    try {
      if (!project.contextSource) {
        logWarn(`[loadProjectContext] Project ${project.name}: No contextSource. Aborting.`);
        return null;
      }
      logInfo(`[loadProjectContext] Starting for project: ${project.name}`);

      logInfo(
        `[loadProjectContext] Project ${project.name}: Cleared all project context load states`
      );

      const contextCache = await this.projectContextCache.getOrInitializeCache(project);

      const projectAllFiles = this.getProjectAllFiles(project);

      // Pre-count all items that need to be processed
      this.loadTracker.preComputeAllItems(project, projectAllFiles);
      this.loadTracker.markAllCachedItemsAsSuccess(project, contextCache, projectAllFiles);

      const [updatedContextCacheAfterSources] = await Promise.all([
        this.processMarkdownFiles(project, contextCache, projectAllFiles),
        this.processWebUrls(project, contextCache),
        this.processYoutubeUrls(project, contextCache),
      ]);

      updatedContextCacheAfterSources.timestamp = Date.now();
      // Note: Since non-markdown files cannot pass cache parameters , so we need to save the context cache first
      await this.projectContextCache.setCacheSafely(project, updatedContextCacheAfterSources);

      // After other contexts are processed, ensure all referenced non-markdown files are parsed and cached
      await this.processNonMarkdownFiles(project, projectAllFiles);

      logInfo(`[loadProjectContext] Completed for project: ${project.name}.`);
      return updatedContextCacheAfterSources;
    } catch (error) {
      logError(`[loadProjectContext] Failed for project ${project.name}:`, error);
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
        // Markdown config changed, invalidate markdown context
        await this.projectContextCache.invalidateMarkdownContext(nextProject);
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
        await this.projectContextCache.removeWebUrls(
          nextProject,
          prevUrls.filter((url) => !nextUrls.includes(url))
        );
      }

      // Check if YouTube URLs configuration has changed
      const prevYoutubeUrls = prevProject.contextSource?.youtubeUrls || "";
      const nextYoutubeUrls = nextProject.contextSource?.youtubeUrls || "";

      if (prevYoutubeUrls !== nextYoutubeUrls) {
        // Find removed URLs
        const prevUrls = prevYoutubeUrls.split("\n").filter((url) => url.trim());
        const nextUrls = nextYoutubeUrls.split("\n").filter((url) => url.trim());

        // Remove context for URLs that no longer exist
        await this.projectContextCache.removeYoutubeUrls(
          nextProject,
          prevUrls.filter((url) => !nextUrls.includes(url))
        );
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
      logWarn(`[getProjectContext] Project not found for ID: ${projectId}`);
      return null;
    }
    logInfo(`[getProjectContext] Getting context for project: ${project.name} (ID: ${projectId})`);

    let contextCache = this.projectContextCache.getSync(project);

    if (!contextCache || contextCache.markdownNeedsReload) {
      if (!contextCache) {
        logInfo(
          `[getProjectContext] Project ${project.name}: Memory cache miss. Triggering full load.`
        );
      } else {
        logInfo(
          `[getProjectContext] Project ${project.name}: Markdown needs reload. Triggering full load.`
        );
      }

      const updatedCache = await this.loadProjectContext(project);
      if (!updatedCache) {
        logError(`[getProjectContext] Project ${project.name}: loadProjectContext returned null.`);
        return null;
      }
      contextCache = updatedCache;
    } else {
      logInfo(
        `[getProjectContext] Project ${project.name}: Memory cache hit and markdown OK. Using existing context.`
      );
    }

    return this.formatProjectContextWithFiles(contextCache, project);
  }

  private async formatProjectContextWithFiles(
    contextCache: ContextCache,
    project: ProjectConfig
  ): Promise<string> {
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

    // Add file contexts section with content loaded from FileCache
    if (Object.keys(contextCache.fileContexts).length > 0) {
      const otherFileContextEntries = Object.entries(contextCache.fileContexts).filter(
        ([filePath]) => {
          const extension = filePath.split(".").pop()?.toLowerCase();
          return extension !== "md"; // Exclude markdown files from "Other Files" section
        }
      );

      if (otherFileContextEntries.length > 0) {
        const fileContextPromises = otherFileContextEntries.map(async ([filePath, fileContext]) => {
          const pathParts = filePath.split("/");
          const fileName = pathParts[pathParts.length - 1];
          const fileType = fileName.split(".").pop() || "";

          // Retrieve file content from FileCache
          const content =
            (await this.projectContextCache.getOrReuseFileContext(project, filePath)) ||
            "[Content not available]"; // This is expected for files not processed into FileCache

          return `[[${fileName}]]\npath: ${filePath}\ntype: ${fileType}\nmodified: ${new Date(fileContext.timestamp).toISOString()}\n\n${content}`;
        });

        const fileContextsStrings = await Promise.all(fileContextPromises);
        if (fileContextsStrings.length > 0) {
          contextParts.push(`## Other Files\n${fileContextsStrings.join("\n\n")}`);
        }
      }
    }

    return `
# Project Context
The following information is the relevant context for this project. Use this information to inform your responses when appropriate:

<ProjectContext>
${contextParts.join("\n\n")}
</ProjectContext>
`;
  }

  // Keep the original formatProjectContext as a fallback for non-async contexts
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

    // Add file contexts section - just include metadata without content
    if (Object.keys(contextCache.fileContexts).length > 0) {
      let fileContextsStr = "";

      for (const [filePath, fileContext] of Object.entries(contextCache.fileContexts)) {
        const pathParts = filePath.split("/");
        const fileName = pathParts[pathParts.length - 1];
        const fileType = fileName.split(".").pop() || "";

        fileContextsStr += `[[${fileName}]]
path: ${filePath}
type: ${fileType}
modified: ${new Date(fileContext.timestamp).toISOString()}\n\n`;
      }

      if (fileContextsStr) {
        contextParts.push(`## Other Files\n${fileContextsStr}`);
      }
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
    contextCache: ContextCache,
    projectAllFiles: TFile[]
  ): Promise<ContextCache> {
    logInfo(`[processMarkdownFiles] Starting for project: ${project.name}`);

    if (
      contextCache.markdownNeedsReload ||
      !contextCache.markdownContext ||
      !contextCache.markdownContext.trim()
    ) {
      logInfo(`[processMarkdownFiles] Project ${project.name}: Processing markdown content.`);
      const markdownContent = await this.processMarkdownFileContext(projectAllFiles);

      // add context reference to markdown file
      this.projectContextCache.updateProjectMarkdownFilesFromPatterns(
        project,
        contextCache,
        projectAllFiles
      );

      contextCache.markdownContext = markdownContent;
      contextCache.markdownNeedsReload = false;

      logInfo(`[processMarkdownFiles] Project ${project.name}: Markdown content updated.`);
    } else {
      logInfo(
        `[processMarkdownFiles] Project ${project.name}: Markdown content already up-to-date.`
      );
    }

    logInfo(
      `[processMarkdownFiles] Completed for project: ${project.name}. Total fileContexts: ${Object.keys(contextCache.fileContexts || {}).length}`
    );
    return contextCache;
  }

  private async processMarkdownFileContext(projectAllFiles: TFile[]): Promise<string> {
    // FileParserManager will be used to process these files when they're accessed,
    // either immediately or on-demand when the context is formatted

    // Get all markdown files that match the inclusion/exclusion patterns
    // Note: We're only processing markdown files here, other file types
    // are handled by FileParserManager and stored in the file cache
    const files = projectAllFiles.filter((file) => file.extension === "md");

    logInfo(`Found ${files.length} markdown files to process for project context`);

    // Process each markdown file with its metadata
    const processedNotes = await Promise.all(
      files.map(async (file: TFile) => {
        let content = "";
        let metadata = "";

        try {
          // Only process markdown files here
          const [stat, fileContent] = await this.loadTracker.executeWithProcessTracking(
            file.path,
            "md",
            async () => {
              return Promise.all([
                this.app.vault.adapter.stat(file.path),
                this.app.vault.read(file),
              ]);
            }
          );

          metadata = `[[${file.basename}]]
path: ${file.path}
type: ${file.extension}
created: ${stat ? new Date(stat.ctime).toISOString() : "unknown"}
modified: ${stat ? new Date(stat.mtime).toISOString() : "unknown"}`;

          content = fileContent;
          logInfo(`Completed processing markdown file: ${file.path}`);
        } catch (error) {
          logError(`Error processing file ${file.path}: ${error}`);
          content = `[Error: ${err2String(error)}]`;
        }

        return `${metadata}\n\n${content}`;
      })
    );

    logInfo("All markdown files processed for project context");

    // Join all processed notes with double newlines
    return processedNotes.join("\n\n");
  }

  private async processWebUrls(
    project: ProjectConfig,
    contextCache: ContextCache
  ): Promise<ContextCache> {
    logInfo(`[processWebUrls] Starting for project: ${project.name}`);
    const configuredUrlsString = project.contextSource?.webUrls?.trim() || "";

    if (!configuredUrlsString) {
      if (Object.keys(contextCache.webContexts).length > 0) {
        logInfo(
          `[processWebUrls] Project ${project.name}: Clearing all Web contexts as none are configured.`
        );
        contextCache.webContexts = {};
      }
      // No need to log if no URLs are configured and cache is already empty.
      return contextCache;
    }

    const urlsInConfig = configuredUrlsString.split("\n").filter((url) => url.trim());
    logInfo(
      `[processWebUrls] Project ${project.name}: Found ${urlsInConfig.length} URLs in config.`
    );
    const currentCachedUrls = Object.keys(contextCache.webContexts);

    const urlsToFetch = urlsInConfig.filter((url) => !contextCache.webContexts[url]);
    if (urlsToFetch.length > 0) {
      logInfo(
        `[processWebUrls] Project ${project.name}: Fetching content for ${urlsToFetch.length} new/updated Web URLs.`
      );
    }

    const urlsToRemove = currentCachedUrls.filter((url) => !urlsInConfig.includes(url));
    if (urlsToRemove.length > 0) {
      logInfo(
        `[processWebUrls] Project ${project.name}: Removing ${urlsToRemove.length} obsolete Web URL contexts.`
      );
      for (const url of urlsToRemove) {
        delete contextCache.webContexts[url];
      }
    }

    const webContextPromises = urlsToFetch.map(async (url) => {
      // processWebUrlContext itself should log errors if a specific URL fetch fails.
      const webContext = await this.processWebUrlContext(url);
      if (webContext) {
        logInfo(
          `[processWebUrls] Project ${project.name}: Successfully fetched content for URL: ${url.substring(0, 50)}...`
        );
      }
      return { url, context: webContext };
    });

    const results = await Promise.all(webContextPromises);
    results.forEach((result) => {
      if (result && result.context) {
        contextCache.webContexts[result.url] = result.context;
      } else if (result && !result.context) {
        logWarn(
          `[processWebUrls] Project ${project.name}: Fetched empty content for Web URL: ${result.url}`
        );
      }
    });
    logInfo(
      `[processWebUrls] Completed for project: ${project.name}. Total Web contexts: ${Object.keys(contextCache.webContexts).length}`
    );
    return contextCache;
  }

  private async processYoutubeUrls(
    project: ProjectConfig,
    contextCache: ContextCache
  ): Promise<ContextCache> {
    logInfo(`[processYoutubeUrls] Starting for project: ${project.name}`);
    const configuredUrlsString = project.contextSource?.youtubeUrls?.trim() || "";

    if (!configuredUrlsString) {
      if (Object.keys(contextCache.youtubeContexts).length > 0) {
        logInfo(
          `[processYoutubeUrls] Project ${project.name}: Clearing all YouTube contexts as none are configured.`
        );
        contextCache.youtubeContexts = {};
      }
      return contextCache;
    }

    const urlsInConfig = configuredUrlsString.split("\n").filter((url) => url.trim());
    logInfo(
      `[processYoutubeUrls] Project ${project.name}: Found ${urlsInConfig.length} YouTube URLs in config.`
    );
    const currentCachedUrls = Object.keys(contextCache.youtubeContexts);

    const urlsToFetch = urlsInConfig.filter((url) => !contextCache.youtubeContexts[url]);
    if (urlsToFetch.length > 0) {
      logInfo(
        `[processYoutubeUrls] Project ${project.name}: Fetching transcripts for ${urlsToFetch.length} new/updated YouTube URLs.`
      );
    }

    const urlsToRemove = currentCachedUrls.filter((url) => !urlsInConfig.includes(url));
    if (urlsToRemove.length > 0) {
      logInfo(
        `[processYoutubeUrls] Project ${project.name}: Removing ${urlsToRemove.length} obsolete YouTube URL contexts.`
      );
      for (const url of urlsToRemove) {
        delete contextCache.youtubeContexts[url];
      }
    }

    const youtubeContextPromises = urlsToFetch.map(async (url) => {
      const youtubeContext = await this.processYoutubeUrlContext(url);
      if (youtubeContext) {
        logInfo(
          `[processYoutubeUrls] Project ${project.name}: Successfully fetched transcript for YouTube URL: ${url.substring(0, 50)}...`
        );
      }
      return { url, context: youtubeContext };
    });

    const results = await Promise.all(youtubeContextPromises);
    results.forEach((result) => {
      if (result && result.context) {
        contextCache.youtubeContexts[result.url] = result.context;
      } else if (result && !result.context) {
        logWarn(
          `[processYoutubeUrls] Project ${project.name}: Fetched empty transcript for YouTube URL: ${result.url}`
        );
      }
    });
    logInfo(
      `[processYoutubeUrls] Completed for project: ${project.name}. Total YouTube contexts: ${Object.keys(contextCache.youtubeContexts).length}`
    );
    return contextCache;
  }

  private async processWebUrlContext(webUrl?: string): Promise<string> {
    if (!webUrl?.trim()) {
      return "";
    }

    try {
      const mention = Mention.getInstance();
      const { urlContext } = await this.loadTracker.executeWithProcessTracking(
        webUrl,
        "web",
        async () => {
          const result = await mention.processUrls(webUrl);

          if (result.processedErrorUrls[webUrl]) {
            throw new Error(result.processedErrorUrls[webUrl]);
          }
          return result;
        }
      );
      return urlContext || "";
    } catch (error) {
      logError(`Failed to process web URL: ${error}`);
      return "";
    }
  }

  private async processYoutubeUrlContext(youtubeUrl?: string): Promise<string> {
    if (!youtubeUrl?.trim()) {
      return "";
    }

    try {
      const response = await this.loadTracker.executeWithProcessTracking(
        youtubeUrl,
        "youtube",
        async () => {
          return BrevilabsClient.getInstance().youtube4llm(youtubeUrl);
        }
      );
      if (response.response.transcript) {
        return `\n\nYouTube transcript from ${youtubeUrl}:\n${response.response.transcript}`;
      }
      return "";
    } catch (error) {
      logError(`Failed to process YouTube URL ${youtubeUrl}: ${error}`);
      new Notice(`Failed to process YouTube URL ${youtubeUrl}: ${err2String(error)}`);
      return "";
    }
  }

  private async processNonMarkdownFiles(
    project: ProjectConfig,
    projectAllFiles: TFile[]
  ): Promise<void> {
    const nonMarkdownFiles = projectAllFiles.filter((file) => file.extension !== "md");

    logInfo(
      `[loadProjectContext] Project ${project.name}: Checking for non-markdown processing: ${nonMarkdownFiles.length} files .`
    );

    if (nonMarkdownFiles.length <= 0) {
      return;
    }

    this.fileParserManager = new FileParserManager(
      BrevilabsClient.getInstance(),
      this.app.vault,
      true,
      project
    );

    let processedNonMdCount = 0;

    for (const file of nonMarkdownFiles) {
      const filePath = file.path;
      if (this.fileParserManager.supportsExtension(file.extension)) {
        try {
          await this.loadTracker.executeWithProcessTracking(filePath, "nonMd", async () => {
            const existingContent = await this.projectContextCache.getOrReuseFileContext(
              project,
              filePath
            );
            if (existingContent) {
              processedNonMdCount++;
            } else {
              logInfo(
                `[loadProjectContext] Project ${project.name}: Parsing/caching new/updated file: ${filePath}`
              );

              await this.fileParserManager.parseFile(file, this.app.vault);
              processedNonMdCount++;
            }
          });
        } catch (error) {
          logError(
            `[loadProjectContext] Project ${project.name}: Error parsing file ${filePath}:`,
            error
          );

          // Check if this is a rate limit error and re-throw it to fail the entire operation
          if (isRateLimitError(error)) {
            throw error; // Re-throw to fail the entire operation
          }
        }
      }
    }

    if (processedNonMdCount > 0) {
      logInfo(
        `[loadProjectContext] Project ${project.name}: Processed and cached ${processedNonMdCount} non-markdown files.`
      );
    }
  }

  /**
   * Retry failed item
   * @param failedItem Failed item information
   */
  public async retryFailedItem(failedItem: FailedItem): Promise<void> {
    try {
      if (!this.currentProjectId) {
        logWarn("[retryFailedItem] No current project, aborting retry");
        return;
      }

      const project = getSettings().projectList.find((p) => p.id === this.currentProjectId);
      if (!project) {
        logError(`[retryFailedItem] Current project not found: ${this.currentProjectId}`);
        return;
      }

      logInfo(`[retryFailedItem] Starting retry for ${failedItem.type} item: ${failedItem.path}`);

      // Handle different retry types
      switch (failedItem.type) {
        case "web":
          await this.retryWebUrl(project, failedItem.path);
          break;
        case "youtube":
          await this.retryYoutubeUrl(project, failedItem.path);
          break;
        case "md":
          await this.retryMarkdownFile(project, failedItem.path);
          break;
        case "nonMd":
          await this.retryNonMarkdownFile(project, failedItem.path);
          break;
        default:
          logWarn(`[retryFailedItem] Unknown item type: ${failedItem.type}`);
          return;
      }

      logInfo(`[retryFailedItem] Successfully retried ${failedItem.type} item: ${failedItem.path}`);
      new Notice(`Retry successful: ${failedItem.path}`);
    } catch (error) {
      logError(
        `[retryFailedItem] Failed to retry ${failedItem.type} item ${failedItem.path}:`,
        error
      );
      new Notice(`Retry failed: ${err2String(error)}`);
    }
  }

  private async retryWebUrl(project: ProjectConfig, url: string): Promise<void> {
    const webContext = await this.processWebUrlContext(url);
    if (!webContext) {
      logWarn(`[retryWebUrl] Project ${project.name}: Fetched empty content for Web URL: ${url}`);
      return;
    }

    logInfo(
      `[retryWebUrl] Project ${project.name}: Successfully fetched content for URL: ${url.substring(0, 50)}...`
    );
    await this.projectContextCache.updateWebUrl(project, url, webContext);
  }

  private async retryYoutubeUrl(project: ProjectConfig, url: string): Promise<void> {
    const youtubeContext = await this.processYoutubeUrlContext(url);
    if (!youtubeContext) {
      logWarn(
        `[retryYoutubeUrl] Project ${project.name}: Fetched empty transcript for YouTube URL: ${url}`
      );
      return;
    }

    logInfo(
      `[retryYoutubeUrl] Project ${project.name}: Successfully fetched transcript for YouTube URL: ${url.substring(0, 50)}...`
    );
    await this.projectContextCache.updateYoutubeUrl(project, url, youtubeContext);
  }

  private async retryMarkdownFile(project: ProjectConfig, filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error(`File not found or not a markdown file: ${filePath}`);
    }

    try {
      // add flag to track reprocessing of Markdown
      await this.loadTracker.executeWithProcessTracking(file.path, "md", async () => {});

      logInfo(`[retryMarkdownFile] Successfully reprocessed markdown file: ${filePath}`);

      // flag the markdown context as needing a reload
      await this.projectContextCache.invalidateMarkdownContext(project);
    } catch (error) {
      logError(`[retryMarkdownFile] Error processing file ${filePath}: ${error}`);
      throw error;
    }
  }

  private async retryNonMarkdownFile(project: ProjectConfig, filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension === "md") {
      throw new Error(`File not found or is a markdown file: ${filePath}`);
    }

    if (!this.fileParserManager.supportsExtension(file.extension)) {
      throw new Error(`Unsupported file extension: ${file.extension}`);
    }

    try {
      await this.loadTracker.executeWithProcessTracking(filePath, "nonMd", async () => {
        return this.fileParserManager.parseFile(file, this.app.vault);
      });

      logInfo(`[retryNonMarkdownFile] Successfully reprocessed non-markdown file: ${filePath}`);
    } catch (error) {
      logError(`[retryNonMarkdownFile] Error processing file ${filePath}: ${error}`);
      throw error;
    }
  }

  private getProjectAllFiles(project: ProjectConfig) {
    // NOTE: Must not fallback to GLOBAL inclusions and exclusions in Copilot settings in Projects!
    // This is to avoid project inclusions in the project that conflict with the global ones
    // Project UI should be the ONLY source of truth for project inclusions and exclusions
    const { inclusions: inclusionPatterns, exclusions: exclusionPatterns } = getMatchingPatterns({
      inclusions: project.contextSource.inclusions,
      exclusions: project.contextSource.exclusions,
      isProject: true,
    });

    return this.app.vault.getFiles().filter((file: TFile) => {
      return shouldIndexFile(file, inclusionPatterns, exclusionPatterns, true);
    });
  }

  public onunload(): void {
    this.projectContextCache.cleanup();
  }
}
