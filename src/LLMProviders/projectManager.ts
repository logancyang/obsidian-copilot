import { App, Notice } from "obsidian";
import ChainManager from "./chainManager";
import VectorStoreManager from "../search/vectorStoreManager";
import { ProjectConfig, subscribeToProjectChange, setProjectLoading } from "../aiParams";
import { logError, logInfo } from "../logger";
import { ChainType } from "@/chainFactory";
import { getSettings } from "@/settings/model";
import { err2String, findCustomModel } from "@/utils";
import { Mention } from "@/mentions/Mention";
import { BrevilabsClient } from "./brevilabsClient";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";

export default class ProjectManager {
  private static instance: ProjectManager;
  private chainManagerMap: Map<string, ChainManager>;
  private currentProjectId: string | null;
  private defaultChainManager: ChainManager;
  private app: App;
  private vectorStoreManager: VectorStoreManager;

  private constructor(app: App, vectorStoreManager: VectorStoreManager) {
    this.app = app;
    this.vectorStoreManager = vectorStoreManager;
    this.chainManagerMap = new Map();
    this.currentProjectId = null;
    this.defaultChainManager = new ChainManager(app, vectorStoreManager);

    // Subscribe to Project changes
    subscribeToProjectChange(async (project) => {
      if (project) {
        await this.switchProject(project);
      } else {
        await this.clearProject();
      }
    });
  }

  public static getInstance(app?: App, vectorStoreManager?: VectorStoreManager): ProjectManager {
    if (!ProjectManager.instance) {
      if (!app || !vectorStoreManager) {
        throw new Error("ProjectManager needs to be initialized with App and VectorStoreManager");
      }
      ProjectManager.instance = new ProjectManager(app, vectorStoreManager);
    }
    return ProjectManager.instance;
  }

  public getCurrentChainManager(): ChainManager {
    if (!this.currentProjectId) {
      return this.defaultChainManager;
    }
    // todo
    return this.chainManagerMap.get(this.currentProjectId)!;
  }

  public async switchProject(project: ProjectConfig): Promise<void> {
    try {
      setProjectLoading(true);
      const projectId = project.id;
      if (this.currentProjectId === projectId) {
        return;
      }

      let chainManager = this.chainManagerMap.get(projectId);
      const isNewChainManager = !chainManager;

      if (isNewChainManager) {
        chainManager = new ChainManager(this.app, this.vectorStoreManager);
        this.chainManagerMap.set(projectId, chainManager);
        await this.setProjectChat(project, chainManager);
      }

      await this.loadProjectContext(project, chainManager!);
      this.currentProjectId = projectId;

      logInfo(`Switched to project: ${project.name}`);
      // 模拟加载耗时
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      logError(`Failed to switch project: ${error}`);
      throw error;
    } finally {
      setProjectLoading(false);
    }
  }

  private async loadProjectContext(
    project: ProjectConfig,
    chainManager: ChainManager
  ): Promise<void> {
    try {
      // await chainManager.memoryManager.clearChatMemory();

      if (project.contextSource) {
        logInfo(`Loading context from sources for project: ${project.name}`);

        const contextParts = await Promise.all([
          this.processMarkdownContext(
            project.contextSource.inclusions,
            project.contextSource.exclusions
          ),
          this.processWebUrlsContext(project.contextSource.webUrls),
          this.processYoutubeUrlsContext(project.contextSource.youtubeUrls),
        ]);

        const contextText = contextParts.join("");
        // todo
        console.log(contextText);
      }

      logInfo(`Loaded context for project: ${project.name}`);
    } catch (error) {
      logError(`Failed to load project context: ${error}`);
      throw error;
    }
  }

  private async setProjectChat(project: ProjectConfig, chainManager: ChainManager): Promise<void> {
    try {
      const customModel = findCustomModel(project.projectModelKey, getSettings().activeModels);
      if (!customModel) {
        throw new Error(`Model not found for key: ${project.projectModelKey}`);
      }

      const mergedModel = {
        ...customModel,
        ...project.modelConfigs,
      };

      await chainManager.chatModelManager.setChatModel(mergedModel);

      await chainManager.setChain(ChainType.PROJECT_CHAIN, {
        prompt: chainManager.promptManager.createProjectChatPrompt(project.systemPrompt),
      });

      logInfo(`Project chat set with model: ${project.projectModelKey}`);
    } catch (error) {
      logError(`setProjectChat failed: ${error}`);
      throw error;
    }
  }

  private async clearProject(): Promise<void> {
    try {
      if (this.currentProjectId) {
        const currentChainManager = this.chainManagerMap.get(this.currentProjectId);
        if (currentChainManager) {
          await currentChainManager.memoryManager.clearChatMemory();
        }
      }
      this.currentProjectId = null;
      logInfo("Project cleared");
    } catch (error) {
      logError(`Failed to clear project: ${error}`);
      throw error;
    }
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
