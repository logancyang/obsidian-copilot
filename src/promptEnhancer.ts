/**
 * 提示词增强功能 (V2)
 *
 * 核心功能：结合对话历史和附加上下文，使用用户自定义的优化指令模板，
 * 调用与当前聊天相同的 AI 模型来重写和优化原始提示词。
 */

import { ChatMessage } from "@/sharedState";
import ChainManager from "@/LLMProviders/chainManager";
import { USER_SENDER } from "@/constants";
import { formatDateTime } from "@/utils";

/**
 * 提示词类型枚举
 */
export enum PromptType {
  CONTENT_GENERATION = "content_generation", // 内容生成类
  ANALYSIS_PROCESSING = "analysis_processing", // 分析处理类
  QA_CONSULTATION = "qa_consultation", // 问答咨询类
  FORMAT_CONVERSION = "format_conversion", // 格式转换类
  GENERAL = "general", // 通用类
}

/**
 * 提示词增强选项接口
 */
export interface EnhancePromptOptions {
  /** 用户输入的原始提示词 */
  originalPrompt: string;
  /** 当前的对话历史记录 */
  chatHistory: ChatMessage[];
  /** 通过 "Add Context" 功能添加的上下文内容 */
  addedContext: string;
  /** 当前聊天正在使用的 AI 模型实例 */
  chainManager: ChainManager;
  /** 从设置中读取的用户自定义优化指令模板 */
  customInstructionTemplate: string;
  /** 可选：指定提示词类型，如不指定则自动检测 */
  promptType?: PromptType;
}

/**
 * 提示词增强结果接口
 */
export interface EnhancePromptResult {
  /** 增强后的提示词 */
  enhancedPrompt: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
  /** 处理时间（毫秒） */
  processingTime: number;
}

/**
 * 提示词增强器类
 */
export class PromptEnhancer {
  /**
   * 检测提示词类型
   */
  private static detectPromptType(prompt: string): PromptType {
    const lowerPrompt = prompt.toLowerCase();

    // 内容生成类关键词
    const generationKeywords = [
      "写",
      "创作",
      "生成",
      "编写",
      "制作",
      "write",
      "create",
      "generate",
      "compose",
      "draft",
    ];

    // 分析处理类关键词
    const analysisKeywords = [
      "总结",
      "分析",
      "翻译",
      "解释",
      "比较",
      "summarize",
      "analyze",
      "translate",
      "explain",
      "compare",
    ];

    // 问答咨询类关键词
    const qaKeywords = [
      "什么",
      "如何",
      "为什么",
      "怎么",
      "建议",
      "what",
      "how",
      "why",
      "suggest",
      "recommend",
    ];

    // 格式转换类关键词
    const formatKeywords = [
      "转换",
      "整理",
      "格式化",
      "重构",
      "convert",
      "format",
      "organize",
      "restructure",
    ];

    if (generationKeywords.some((keyword) => lowerPrompt.includes(keyword))) {
      return PromptType.CONTENT_GENERATION;
    }

    if (analysisKeywords.some((keyword) => lowerPrompt.includes(keyword))) {
      return PromptType.ANALYSIS_PROCESSING;
    }

    if (qaKeywords.some((keyword) => lowerPrompt.includes(keyword))) {
      return PromptType.QA_CONSULTATION;
    }

    if (formatKeywords.some((keyword) => lowerPrompt.includes(keyword))) {
      return PromptType.FORMAT_CONVERSION;
    }

    return PromptType.GENERAL;
  }
  /**
   * 增强提示词的核心函数
   */
  static async enhancePrompt(options: EnhancePromptOptions): Promise<EnhancePromptResult> {
    const startTime = Date.now();

    try {
      // 验证输入
      if (!options.originalPrompt.trim()) {
        throw new Error("原始提示词不能为空");
      }

      if (!options.chainManager) {
        throw new Error("ChainManager 未设置");
      }

      // 构建元提示词
      const metaPrompt = PromptEnhancer.buildMetaPrompt(options);

      // 调用 AI 模型
      const enhancedPrompt = await PromptEnhancer.callEnhancementAPI(
        metaPrompt,
        options.chainManager
      );

      // 清理和验证结果
      const cleanedPrompt = PromptEnhancer.cleanEnhancedPrompt(enhancedPrompt);

      const processingTime = Date.now() - startTime;

      return {
        enhancedPrompt: cleanedPrompt,
        success: true,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      return {
        enhancedPrompt: options.originalPrompt, // 返回原始提示词作为回退
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
        processingTime,
      };
    }
  }

  /**
   * 构建元提示词（用于发送给 AI 的优化指令）
   */
  private static buildMetaPrompt(options: EnhancePromptOptions): string {
    const { originalPrompt, chatHistory, addedContext, customInstructionTemplate } = options;

    // 格式化对话历史
    const formattedChatHistory = PromptEnhancer.formatChatHistory(chatHistory);

    console.log("Building meta prompt with:", {
      originalPrompt,
      formattedChatHistory,
      addedContext,
      template: customInstructionTemplate,
    });

    // 如果模板不存在，使用默认模板
    const defaultTemplate = `You are PromptEngineer, an expert AI assistant specialized in optimizing prompts to be more effective, specific, and actionable.

TASK:
Transform the user's original prompt into an enhanced version that is clearer, more specific, and better structured for optimal AI understanding and response quality.

CONTEXT:
Conversation History:
{{history}}

Additional Context:
{{context}}

Original Prompt:
{{prompt}}

INSTRUCTIONS:
1. Analyze the original prompt, conversation history, and provided context
2. Identify key objectives, requirements, and implied expectations
3. Incorporate relevant context from the conversation history
4. Structure the enhanced prompt with clear instructions and parameters
5. Make the prompt more specific, detailed, and action-oriented
6. Use precise technical language appropriate to the subject matter
7. Output ONLY the enhanced prompt text with no explanations, prefixes, or placeholders

OUTPUT ONLY THE ENHANCED PROMPT WITHOUT ANY EXPLANATION, PREFIX OR SUFFIX.`;

    // 替换模板中的占位符 - 支持三种格式
    const result = (customInstructionTemplate || defaultTemplate)
      // 双花括号格式
      .replace(/\{\{prompt\}\}/g, originalPrompt)
      .replace(/\{\{history\}\}/g, formattedChatHistory)
      .replace(/\{\{context\}\}/g, addedContext)
      .replace(/\{\{original_prompt\}\}/g, originalPrompt)
      .replace(/\{\{chat_history\}\}/g, formattedChatHistory)
      .replace(/\{\{added_context\}\}/g, addedContext)
      // 单花括号格式（用户当前使用的格式）
      .replace(/\{prompt\}/g, originalPrompt)
      .replace(/\{history\}/g, formattedChatHistory)
      .replace(/\{context\}/g, addedContext)
      .replace(/\{original_prompt\}/g, originalPrompt)
      .replace(/\{chat_history\}/g, formattedChatHistory)
      .replace(/\{added_context\}/g, addedContext);

    console.log("Meta prompt after replacement:", result);
    return result;
  }

  /**
   * 格式化对话历史为可读文本
   */
  private static formatChatHistory(chatHistory: ChatMessage[]): string {
    if (!chatHistory || chatHistory.length === 0) {
      return "（暂无对话历史）";
    }

    // 只取最近的几轮对话，避免上下文过长
    const recentHistory = chatHistory.slice(-10);

    return recentHistory
      .filter((msg) => msg.isVisible !== false) // 过滤掉隐藏的消息
      .map((msg) => {
        const sender = msg.sender === USER_SENDER ? "用户" : "AI";
        return `${sender}: ${msg.message}`;
      })
      .join("\n");
  }

  /**
   * 调用增强 API
   */
  private static async callEnhancementAPI(
    metaPrompt: string,
    chainManager: ChainManager
  ): Promise<string> {
    // 创建一个临时的消息对象用于 API 调用
    const tempMessage: ChatMessage = {
      message: metaPrompt,
      sender: USER_SENDER,
      isVisible: false,
      timestamp: formatDateTime(new Date()),
    };

    // 使用现有的 AI 调用逻辑
    let result = "";
    let lastValidResult = ""; // 保存最后一个有效结果
    const abortController = new AbortController();

    // 创建一个 Promise 来处理流式响应
    return new Promise((resolve, reject) => {
      const updateCurrentAiMessage = (message: string) => {
        console.log("Enhancement API response chunk:", message); // 调试日志

        // 只有当消息不为空且不是纯空白字符时才更新结果
        if (message && message.trim() !== "") {
          result = message;
          lastValidResult = message; // 保存有效结果
          console.log("Updated valid result:", message);
        } else {
          console.log("Ignoring empty chunk:", JSON.stringify(message));
        }
      };

      const addMessage = (message: ChatMessage) => {
        console.log("Enhancement API addMessage called:", message); // 调试日志

        // 只处理 AI 的响应消息
        if (message.sender !== USER_SENDER && message.message && message.message.trim() !== "") {
          result = message.message;
          lastValidResult = message.message; // 保存有效结果
          console.log("Enhancement API final message:", message.message);
        }
      };

      // 调用 chainManager 的 runChain 方法
      chainManager
        .runChain(tempMessage, abortController, updateCurrentAiMessage, addMessage, {
          debug: false,
          ignoreSystemMessage: false,
        })
        .then(() => {
          // 优先使用最后一个有效结果
          const finalResult = lastValidResult || result;
          console.log("Enhancement API completed, final result:", finalResult); // 调试日志

          if (!finalResult || finalResult.trim() === "") {
            reject(new Error("AI 返回了空的增强结果"));
          } else {
            resolve(finalResult);
          }
        })
        .catch((error) => {
          console.error("Enhancement API error:", error); // 调试日志
          reject(error);
        });
    });
  }

  /**
   * 清理增强后的提示词
   */
  private static cleanEnhancedPrompt(enhancedPrompt: string): string {
    console.log("Cleaning enhanced prompt:", enhancedPrompt);

    if (!enhancedPrompt) {
      throw new Error("AI 返回了空的增强结果");
    }

    // 移除可能的前缀和后缀
    let cleaned = enhancedPrompt.trim();

    // 检查是否包含未替换的占位符，如果有则说明占位符替换失败
    const placeholderPatterns = [
      /\{\{[^}]+\}\}/g, // 双花括号格式
      /\{(chat_history|added_context|original_prompt|prompt|history|context)\}/g, // 特定的单花括号格式
    ];

    for (const pattern of placeholderPatterns) {
      const matches = cleaned.match(pattern);
      if (matches) {
        console.warn("AI response contains unreplaced placeholders:", matches, "in:", cleaned);
        throw new Error(
          `AI 返回的内容包含未替换的占位符: ${matches.join(", ")}。这表明占位符替换失败，请检查模板格式。`
        );
      }
    }

    // 移除常见的 AI 回复前缀
    const prefixesToRemove = [
      "优化后的提示词：",
      "增强后的提示词：",
      "改写后的指令：",
      "优化后的指令：",
      "以下是优化后的提示词：",
      "这是优化后的提示词：",
      "请根据提供的对话历史和补充上下文，执行以下指令：",
      "根据对话历史和上下文，优化后的提示词是：",
    ];

    for (const prefix of prefixesToRemove) {
      if (cleaned.startsWith(prefix)) {
        cleaned = cleaned.substring(prefix.length).trim();
        break;
      }
    }

    // 移除引号包围
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    // 移除代码块标记
    if (cleaned.startsWith("```") && cleaned.endsWith("```")) {
      cleaned = cleaned
        .replace(/^```[\w]*\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
    }

    console.log("Cleaned result:", cleaned);

    if (!cleaned) {
      throw new Error("清理后的增强结果为空");
    }

    return cleaned;
  }
}

/**
 * 导出便捷函数
 */
export const enhancePrompt = PromptEnhancer.enhancePrompt;
