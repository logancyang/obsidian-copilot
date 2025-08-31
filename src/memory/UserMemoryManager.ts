import { App, TFile } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { USER_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const MAX_MEMORY_LINES = 40;
/**
 * User Memory Management Class
 *
 * Static methods for building and managing user memory based on conversations.
 * The UserMemoryManager has methods to add recent conversations, user facts to the user memory
 * which can then be used to personalize LLM response.
 */
export class UserMemoryManager {
  /**
   * Runs the user memory operation in the background without blocking execution
   */
  static updateUserMemory(app: App, messages: ChatMessage[], chatModel?: BaseChatModel): void {
    const settings = getSettings();

    // Only proceed if memory is enabled
    if (!settings.enableMemory) {
      logInfo("[UserMemoryManager] User memory tracking is disabled, skipping analysis");
      return;
    }

    if (messages.length === 0) {
      logInfo("[UserMemoryManager] No messages to analyze for user memory");
      return;
    }

    // Fire and forget - run in background
    updateMemory(app, messages, chatModel).catch((error) => {
      logError("[UserMemoryManager] Background user memory operation failed:", error);
    });
  }

  /**
   * Get user memory prompt
   */
  static async getUserMemoryPrompt(app: App): Promise<string | null> {
    const memoryFileMap = {
      "Recent Conversation Content": getRecentConversationFilePath(),
      "User Insights": getUserInsightsFilePath(),
      "Response Preferences": getResponsePreferencesFilePath(),
    };

    try {
      let memoryPrompt = "";

      // Read all memory files using the map
      for (const [sectionName, filePath] of Object.entries(memoryFileMap)) {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const content = await app.vault.read(file);
          if (content) {
            memoryPrompt += `\n# ${sectionName}\n${content}\n`;
          }
        }
      }

      return memoryPrompt.length > 0 ? memoryPrompt : null;
    } catch (error) {
      logError("[UserMemoryManager] Error reading user memory content:", error);
      return null;
    }
  }
}

/**
 * Analyze chat messages and store useful information in user memory files
 */
async function updateMemory(
  app: App,
  messages: ChatMessage[],
  chatModel?: BaseChatModel
): Promise<void> {
  try {
    // Ensure user memory folder exists
    await ensureMemoryFolderExists(app);

    if (!chatModel) {
      logError("[UserMemoryManager] No chat model available, skipping memory update");
      return;
    }

    if (messages.length === 0) {
      logInfo("[UserMemoryManager] No messages available, skipping memory update");
      return;
    }

    // Extract all information in a single LLM call for better performance
    const extractedInfo = await extractConversationInfo(app, messages, chatModel);

    // 1. Save conversation summary to recent conversations
    const timestamp = new Date().toISOString().split(".")[0]; // Remove milliseconds and Z
    const userMessageTexts = messages
      .filter((message) => message.sender === USER_SENDER)
      .map((message) => message.message);
    const content = userMessageTexts.join("||||");
    const conversationLine = `${timestamp} ${extractedInfo.summary}||||${content}`;

    if (conversationLine) {
      await addToMemoryFile(app, getRecentConversationFilePath(), conversationLine);
    }

    // 2. Save user insights (if extracted)
    if (extractedInfo.userInsights) {
      try {
        await addToMemoryFile(app, getUserInsightsFilePath(), extractedInfo.userInsights);
      } catch (error) {
        logError("[UserMemoryManager] Error saving user insights:", error);
      }
    }
  } catch (error) {
    logError("[UserMemoryManager] Error analyzing chat messages for user memory:", error);
  }
}

/**
 * Ensure the user memory folder exists
 */
async function ensureMemoryFolderExists(app: App): Promise<void> {
  const settings = getSettings();
  const memoryFolderPath = settings.memoryFolderName;

  const folder = app.vault.getAbstractFileByPath(memoryFolderPath);
  if (!folder) {
    await app.vault.createFolder(memoryFolderPath);
    logInfo(`[UserMemoryManager] Created user memory folder: ${memoryFolderPath}`);
  }
}

function getRecentConversationFilePath(): string {
  const settings = getSettings();
  return `${settings.memoryFolderName}/recent_conversation_content.md`;
}

function getUserInsightsFilePath(): string {
  const settings = getSettings();
  return `${settings.memoryFolderName}/user_insights.md`;
}

/**
 * Save content to the user memory file by appending new conversation
 */
async function addToMemoryFile(app: App, filePath: string, newContent: string): Promise<void> {
  const newConversationLine = `- ${newContent}`;

  try {
    const existingFile = app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      // Read existing conversation lines, append the new line.
      // Make sure the content lines do not exceed 40 lines. If it does, remove the first line.
      const fileContent = await app.vault.read(existingFile);
      const lines = fileContent.split("\n");
      lines.push(newConversationLine);

      if (lines.length > MAX_MEMORY_LINES) {
        // Remove the first line to keep within 40 lines limit
        lines.shift();
      }

      const updatedContent = lines.join("\n");
      await app.vault.modify(existingFile, updatedContent);
    } else {
      await app.vault.create(filePath, newConversationLine);
    }
  } catch (error) {
    logError(`[UserMemoryManager] Error saving to user memory file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Extract all conversation information using a single LLM call for better performance
 */
async function extractConversationInfo(
  app: App,
  messages: ChatMessage[],
  chatModel: BaseChatModel
): Promise<{
  summary: string;
  userInsights: string | null;
}> {
  const conversationText = messages.map((msg) => `${msg.sender}: ${msg.message}`).join("\n\n");

  // Read existing memory to avoid duplication
  let existingInsights = "";

  try {
    const userInsightsFile = app.vault.getAbstractFileByPath(getUserInsightsFilePath());
    if (userInsightsFile instanceof TFile) {
      existingInsights = await app.vault.read(userInsightsFile);
    }
  } catch (error) {
    logError("[UserMemoryManager] Error reading existing memory files:", error);
  }

  const systemPrompt = `You are an AI assistant that analyzes conversations and extracts three types of information:

1. CONVERSATION SUMMARY: Create a very brief summary in 2-5 words maximum (e.g., "Travel Plan", "Tokyo Weather")

2. USER INSIGHTS: Extract NEW factual information or preferences about the user such as:
   - Their role/profession
   - Technologies they work with  
   - Projects they're working on
   - Skills and expertise areas
   - Learning goals or interests
   - Preferred level of detail (brief vs detailed explanations)
   - Communication style (formal vs casual)
   - Explanation depth (beginner vs advanced)
   - Format preferences (step-by-step vs narrative)
   - Specific requests about how to present information

IMPORTANT: Only extract NEW information that is NOT already captured in the existing memory below.

<existing_insights>
${existingInsights || "None"}
</existing_insights>

# OUTPUT FORMAT
Return your analysis in this exact JSON format with below keys:
* summary: brief 2-5 word summary.
* userInsights (optional): Only return if there are new insights found.`;

  const humanPrompt = `Analyze this conversation and extract the summary and any NEW user insights not already captured:

${conversationText}`;

  const messages_llm = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

  try {
    const response = await chatModel.invoke(messages_llm);
    const responseText = response.content.toString().trim();

    // Parse JSON response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (parseError) {
      logError("[UserMemoryManager] Failed to parse LLM response as JSON:", parseError);
    }

    return parsedResponse;
  } catch (error) {
    logError("[UserMemoryManager] Failed to extract conversation info:", error);
    return {
      summary: "No summary",
      userInsights: null,
    };
  }
}
