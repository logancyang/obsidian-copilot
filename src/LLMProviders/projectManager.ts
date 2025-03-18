import { App, Notice } from "obsidian";
import ChainManager from "./chainManager";
import VectorStoreManager from "../search/vectorStoreManager";
import { ProjectConfig, setProjectLoading, subscribeToProjectChange } from "../aiParams";
import { logError, logInfo } from "@/logger";
import { ChainType } from "@/chainFactory";
import { getSettings } from "@/settings/model";
import { err2String, findCustomModel } from "@/utils";
import { Mention } from "@/mentions/Mention";
import { BrevilabsClient } from "./brevilabsClient";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import CopilotPlugin from "@/main";
import { BUILTIN_CHAT_MODELS, CHAT_VIEWTYPE } from "@/constants";
import CopilotView from "@/components/CopilotView";

export default class ProjectManager {
  private static instance: ProjectManager;
  private chainManagerMap: Map<string, ChainManager>;
  private currentProjectId: string | null;
  private defaultChainManager: ChainManager;
  private app: App;
  private vectorStoreManager: VectorStoreManager;
  private plugin: CopilotPlugin;

  private constructor(app: App, vectorStoreManager: VectorStoreManager, plugin: CopilotPlugin) {
    this.app = app;
    this.vectorStoreManager = vectorStoreManager;
    this.plugin = plugin;
    this.chainManagerMap = new Map();
    this.currentProjectId = null;
    this.defaultChainManager = new ChainManager(app, vectorStoreManager);

    // Subscribe to Project changes
    subscribeToProjectChange(async (project) => {
      if (project) {
        await this.switchProject(project);
        return;
      }
      // clear project and switch to defaultChainManager
      const currentProjectId = this.currentProjectId;
      this.currentProjectId = null; // ensure set currentProjectId to null
      this.switchDefaultChainManager();
      await this.clearProject(currentProjectId);
    });
  }

  public static getInstance(
    app?: App,
    vectorStoreManager?: VectorStoreManager,
    plugin?: CopilotPlugin
  ): ProjectManager {
    if (!ProjectManager.instance) {
      if (!app || !vectorStoreManager || !plugin) {
        throw new Error(
          "ProjectManager needs to be initialized with App, VectorStoreManager and Plugin"
        );
      }
      ProjectManager.instance = new ProjectManager(app, vectorStoreManager, plugin);
    }
    return ProjectManager.instance;
  }

  public getCurrentChainManager(): ChainManager {
    // if this.currentProjectId not exist, should use this.defaultChainManager
    if (!this.currentProjectId) {
      return this.defaultChainManager;
    }
    // otherwise
    const m = this.chainManagerMap.get(this.currentProjectId);
    if (!m) {
      throw new Error(`ChainManager not found for project: ${this.currentProjectId}`);
    }
    return m;
  }

  public async switchProject(project: ProjectConfig): Promise<void> {
    try {
      setProjectLoading(true);
      const projectId = project.id;
      if (this.currentProjectId === projectId) {
        return;
      }
      this.currentProjectId = projectId;

      // 保存当前项目的聊天记录
      await this.plugin.autosaveCurrentChat();

      // get or create chainManager
      let chainManager = this.chainManagerMap.get(projectId);
      if (!chainManager) {
        chainManager = new ChainManager(this.app, this.vectorStoreManager);
        this.chainManagerMap.set(projectId, chainManager);
      }

      await Promise.all([
        this.setProjectChatModel(project),
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

  private async loadProjectContext(project: ProjectConfig): Promise<void> {
    try {
      if (project.contextSource) {
        const contextParts = await Promise.all([
          this.processMarkdownContext(
            project.contextSource.inclusions,
            project.contextSource.exclusions
          ),
          this.processWebUrlsContext(project.contextSource.webUrls),
          this.processYoutubeUrlsContext(project.contextSource.youtubeUrls),
        ]);

        const contextText = contextParts.join("");
        // todo  待处理 context
        console.log(contextText);
      }
    } catch (error) {
      logError(`Failed to load project context: ${error}`);
      throw error;
    }
  }

  private async setProjectChatModel(project: ProjectConfig): Promise<void> {
    let newModelKey = project.projectModelKey;
    try {
      let customModel = findCustomModel(newModelKey, getSettings().activeModels);
      if (!customModel) {
        // Reset default model if no model is found
        console.error("Resetting default model. No model configuration found for: ", newModelKey);
        customModel = BUILTIN_CHAT_MODELS[0];
        newModelKey = customModel.name + "|" + customModel.provider;
      }

      const mergedModel = {
        ...customModel,
        ...project.modelConfigs,
      };

      const currentChainManager = this.getCurrentChainManager();
      await currentChainManager.chatModelManager.setChatModel(mergedModel);

      await currentChainManager.setChain(ChainType.PROJECT_CHAIN, {
        prompt: currentChainManager.promptManager.createProjectChatPrompt(project.systemPrompt),
      });
    } catch (error) {
      logError(`setProjectChat failed: ${error}`);
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

  private async clearProject(currentProjectId: string | null) {
    try {
      const currentChainManager = currentProjectId
        ? this.chainManagerMap.get(currentProjectId)
        : null;
      if (currentChainManager) {
        // todo 需不需要保存？
        await this.plugin.autosaveCurrentChat();
      }

      logInfo("Project cleared");
    } catch (error) {
      logError(`Failed to clear project: ${error}`);
      throw error;
    }
  }

  private switchDefaultChainManager() {
    this.refreshChatView();
  }

  public getDefaultChainManager(): ChainManager {
    return this.defaultChainManager;
  }

  public async dispose(): Promise<void> {
    try {
      // 清理所有 ChainManager 资源
      for (const chainManager of this.chainManagerMap.values()) {
        await chainManager.memoryManager.clearChatMemory();
      }
      this.chainManagerMap.clear();
      await this.defaultChainManager.memoryManager.clearChatMemory();
      logInfo("ProjectManager disposed");
    } catch (error) {
      logError(`Failed to dispose ProjectManager: ${error}`);
      throw error;
    }
  }

  /**
   * 处理 Markdown 文件上下文
   * @param inclusions - 包含的模式
   * @param exclusions - 排除的模式
   * @returns 所有匹配文件的内容
   */
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

  /**
   * 处理 Web URLs 上下文
   */
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

  /**
   * 处理 YouTube URLs 上下文
   */
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
