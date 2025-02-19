import { App, Notice } from "obsidian";
import ChainManager from "./chainManager";
import VectorStoreManager from "../search/vectorStoreManager";
import {
  getChainType,
  isProjectMode,
  ProjectConfig,
  setProjectLoading,
  subscribeToChainTypeChange,
  subscribeToModelKeyChange,
  subscribeToProjectChange,
} from "@/aiParams";
import { logError, logInfo } from "@/logger";
import { ChainType } from "@/chainFactory";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { err2String } from "@/utils";
import { Mention } from "@/mentions/Mention";
import { BrevilabsClient } from "./brevilabsClient";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import CopilotPlugin from "@/main";
import { CHAT_VIEWTYPE, VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import CopilotView from "@/components/CopilotView";
import { ChatMessage } from "@/sharedState";
import { updateChatMemory } from "@/chatUtils";

export default class ProjectManager {
  public static instance: ProjectManager;
  private currentProjectId: string | null;
  private app: App;
  private plugin: CopilotPlugin;
  private readonly chainMangerInstance: ChainManager;

  private projectContextCache: Map<string, string>;
  private chatMessageCache: Map<string, ChatMessage[]>;

  private defaultProjectKey: string = "defaultProjectKey";

  private constructor(app: App, vectorStoreManager: VectorStoreManager, plugin: CopilotPlugin) {
    this.app = app;
    this.plugin = plugin;
    this.currentProjectId = null;

    this.chainMangerInstance = new ChainManager(app, vectorStoreManager);
    this.projectContextCache = new Map();
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
            this.clearContextCache(nextProject.id);

            // If this is the current project, reload its context
            if (this.currentProjectId === nextProject.id) {
              console.log("reload its context");
              await this.loadProjectContext(nextProject);
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

    // todo 需不需要？
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

  private async loadProjectContext(project: ProjectConfig): Promise<void> {
    try {
      if (project.contextSource) {
        if (this.projectContextCache.has(project.id)) {
          logInfo(`Using cached context for project: ${project.name}`);
          return;
        }

        const contextParts = await Promise.all([
          this.processMarkdownContext(
            project.contextSource.inclusions,
            project.contextSource.exclusions
          ),
          this.processWebUrlsContext(project.contextSource.webUrls),
          this.processYoutubeUrlsContext(project.contextSource.youtubeUrls),
        ]).then((res) => res.filter((it) => !!it));

        const contextText = `

<ProjectContext>
# Project Context
The following information is relevant context for this project. Use this information to inform your responses when appropriate:

${contextParts.join("\n")}
<ProjectContext>
`;

        this.projectContextCache.set(project.id, contextText);
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
    return this.projectContextCache.get(projectId) || null;
  }

  public clearContextCache(projectId: string): void {
    this.projectContextCache.delete(projectId);
    logInfo(`Context cache cleared for project: ${projectId}`);
  }

  private async processMarkdownContext(inclusions?: string, exclusions?: string): Promise<string> {
    if (!inclusions && !exclusions) {
      return "";
    }

    let allContent = "";
    const { inclusions: inclusionPatterns, exclusions: exclusionPatterns } = getMatchingPatterns({
      inclusions,
      exclusions,
    });

    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      return shouldIndexFile(file, inclusionPatterns, exclusionPatterns);
    });

    await Promise.all(files.map((file) => this.app.vault.cachedRead(file))).then((contents) =>
      contents.map((c) => (allContent += c + " "))
    );

    return allContent;
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
