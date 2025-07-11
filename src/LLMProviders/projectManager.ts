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
import { logError, logInfo, logWarn } from "@/logger";
import CopilotPlugin from "@/main";
import { Mention } from "@/mentions/Mention";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { FileParserManager } from "@/tools/FileParserManager";
import { err2String } from "@/utils";
import { isRateLimitError } from "@/utils/rateLimitUtils";
import { App, Notice, TFile } from "obsidian";
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
  private fileParserManager: FileParserManager;

  private constructor(app: App, vectorStoreManager: VectorStoreManager, plugin: CopilotPlugin) {
    this.app = app;
    this.plugin = plugin;
    this.currentProjectId = null;
    this.chainMangerInstance = new ChainManager(app, vectorStoreManager);
    this.projectContextCache = ProjectContextCache.getInstance();
    this.chatMessageCache = new Map();
    this.fileParserManager = new FileParserManager(
      BrevilabsClient.getInstance(),
      this.app.vault,
      true,
      null
    );

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

  private async loadProjectContext(project: ProjectConfig): Promise<ContextCache | null> {
    try {
      if (!project.contextSource) {
        logWarn(`[loadProjectContext] Project ${project.name}: No contextSource. Aborting.`);
        return null;
      }
      logInfo(`[loadProjectContext] Starting for project: ${project.name}`);

      const initialProjectCache = await this.projectContextCache.get(project);
      const contextCache = initialProjectCache || {
        markdownContext: "",
        webContexts: {},
        youtubeContexts: {},
        fileContexts: {},
        timestamp: Date.now(),
        markdownNeedsReload: true,
      };
      if (!initialProjectCache) {
        logInfo(
          `[loadProjectContext] Project ${project.name}: No existing cache found, building fresh context.`
        );
      } else {
        logInfo(
          `[loadProjectContext] Project ${project.name}: Existing cache found. MarkdownNeedsReload: ${contextCache.markdownNeedsReload}`
        );
      }

      const [updatedContextCacheAfterSources] = await Promise.all([
        this.processMarkdownFiles(project, contextCache),
        this.processWebUrls(project, contextCache),
        this.processYoutubeUrls(project, contextCache),
      ]);

      // After other contexts are processed, ensure all referenced non-markdown files are parsed and cached
      if (updatedContextCacheAfterSources.fileContexts) {
        const fileContextCount = Object.keys(updatedContextCacheAfterSources.fileContexts).length;
        logInfo(
          `[loadProjectContext] Project ${project.name}: Checking ${fileContextCount} fileContexts for non-markdown processing.`
        );

        if (fileContextCount > 0) {
          this.fileParserManager = new FileParserManager(
            BrevilabsClient.getInstance(),
            this.app.vault,
            true,
            project
          );
          let processedNonMdCount = 0;
          for (const filePath in updatedContextCacheAfterSources.fileContexts) {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile && file.extension !== "md") {
              if (this.fileParserManager.supportsExtension(file.extension)) {
                try {
                  const existingContent = await this.projectContextCache.getFileContext(
                    project,
                    filePath
                  );
                  if (!existingContent) {
                    logInfo(
                      `[loadProjectContext] Project ${project.name}: Parsing/caching new/updated file: ${filePath}`
                    );
                    await this.fileParserManager.parseFile(file, this.app.vault);
                    processedNonMdCount++;
                  } // else { logInfo for skipped can be too verbose }
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
          }
          if (processedNonMdCount > 0) {
            logInfo(
              `[loadProjectContext] Project ${project.name}: Processed and cached ${processedNonMdCount} non-markdown files.`
            );
          }
        }
      }

      updatedContextCacheAfterSources.timestamp = Date.now();
      await this.projectContextCache.set(project, updatedContextCacheAfterSources);
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
        for (const url of prevUrls) {
          if (!nextUrls.includes(url)) {
            await this.projectContextCache.removeWebUrl(nextProject, url);
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
          if (!nextUrls.includes(url)) {
            await this.projectContextCache.removeYoutubeUrl(nextProject, url);
          }
        }
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
            (await this.projectContextCache.getFileContext(project, filePath)) ||
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
    contextCache: ContextCache
  ): Promise<ContextCache> {
    logInfo(`[processMarkdownFiles] Starting for project: ${project.name}`);
    const initialFileContextsCount = Object.keys(contextCache.fileContexts || {}).length;

    if (project.contextSource?.inclusions || project.contextSource?.exclusions) {
      contextCache = await this.projectContextCache.updateProjectFilesFromPatterns(
        project,
        contextCache
      );
      const newFileContextsCount = Object.keys(contextCache.fileContexts || {}).length;
      if (newFileContextsCount > initialFileContextsCount) {
        logInfo(
          `[processMarkdownFiles] Project ${project.name}: Added ${newFileContextsCount - initialFileContextsCount} new file references via updateProjectFilesFromPatterns.`
        );
      }

      if (
        contextCache.markdownNeedsReload ||
        !contextCache.markdownContext ||
        !contextCache.markdownContext.trim()
      ) {
        logInfo(`[processMarkdownFiles] Project ${project.name}: Processing markdown content.`);
        const markdownContent = await this.processFileContext(
          project.contextSource.inclusions,
          project.contextSource.exclusions,
          project
        );
        contextCache.markdownContext = markdownContent;
        contextCache.markdownNeedsReload = false;
        logInfo(`[processMarkdownFiles] Project ${project.name}: Markdown content updated.`);
      } else {
        logInfo(
          `[processMarkdownFiles] Project ${project.name}: Markdown content already up-to-date.`
        );
      }
    }
    logInfo(
      `[processMarkdownFiles] Completed for project: ${project.name}. Total fileContexts: ${Object.keys(contextCache.fileContexts || {}).length}`
    );
    return contextCache;
  }

  private async processFileContext(
    inclusions?: string,
    exclusions?: string,
    project?: ProjectConfig
  ): Promise<string> {
    if (!inclusions && !exclusions) {
      return "";
    }

    if (!project) {
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

    // FileParserManager will be used to process these files when they're accessed,
    // either immediately or on-demand when the context is formatted

    // Get all markdown files that match the inclusion/exclusion patterns
    // Note: We're only processing markdown files here, other file types
    // are handled by FileParserManager and stored in the file cache
    const files = this.app.vault.getFiles().filter((file) => {
      return file.extension === "md" && shouldIndexFile(file, inclusionPatterns, exclusionPatterns);
    });

    logInfo(`Found ${files.length} markdown files to process for project context`);

    // Process each markdown file with its metadata
    const processedNotes = await Promise.all(
      files.map(async (file: TFile) => {
        let content = "";
        let metadata = "";

        try {
          const stat = await this.app.vault.adapter.stat(file.path);
          metadata = `[[${file.basename}]]
path: ${file.path}
type: ${file.extension}
created: ${stat ? new Date(stat.ctime).toISOString() : "unknown"}
modified: ${stat ? new Date(stat.mtime).toISOString() : "unknown"}`;

          // Only process markdown files here
          content = await this.app.vault.read(file);
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
      // processWebUrlsContext itself should log errors if a specific URL fetch fails.
      const webContext = await this.processWebUrlsContext(url);
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
      const youtubeContext = await this.processYoutubeUrlsContext(url);
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
