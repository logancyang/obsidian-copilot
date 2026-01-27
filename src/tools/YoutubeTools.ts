import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { extractAllYoutubeUrls } from "@/utils";
import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";

// Maximum input length to prevent potential DoS attacks
const MAX_USER_MESSAGE_LENGTH = 50000; // Maximum number of characters

interface YouTubeHandlerArgs {
  _userMessageContent?: string;
}

const youtubeTranscriptionTool = createLangChainTool({
  name: "youtubeTranscription",
  description: "Get transcripts of YouTube videos when the user provides YouTube URLs",
  schema: z.object({
    _userMessageContent: z
      .string()
      .optional()
      .describe("Internal: user message content injected by the system"),
  }),
  func: async (args: YouTubeHandlerArgs) => {
    // The _userMessageContent is injected by the tool execution system
    const { _userMessageContent } = args;

    // Input validation
    if (typeof _userMessageContent !== "string") {
      return {
        success: false,
        message: "Invalid input: User message must be a string",
      };
    }

    if (_userMessageContent.length > MAX_USER_MESSAGE_LENGTH) {
      return {
        success: false,
        message: `Input too long: Maximum allowed length is ${MAX_USER_MESSAGE_LENGTH} characters`,
      };
    }

    // Extract YouTube URLs only from the user's message
    const urls = extractAllYoutubeUrls(_userMessageContent);

    if (urls.length === 0) {
      return {
        success: false,
        message:
          "No YouTube URLs found in the user prompt. URLs must be in the user prompt instead of the context notes.",
      };
    }

    // Process multiple URLs if present
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const response = await BrevilabsClient.getInstance().youtube4llm(url);

          // Check if transcript is empty
          if (!response.response.transcript) {
            return {
              url,
              success: false,
              message:
                "Transcript not available. Only English videos with auto transcript enabled are supported",
            };
          }

          return {
            url,
            success: true,
            transcript: response.response.transcript,
            elapsed_time_ms: response.elapsed_time_ms,
          };
        } catch (error) {
          console.error(`Error transcribing YouTube video ${url}:`, error);
          return {
            url,
            success: false,
            message: "An error occurred while transcribing the YouTube video",
          };
        }
      })
    );

    // Check if at least one transcription was successful
    const hasSuccessfulTranscriptions = results.some((result) => result.success);

    return {
      success: hasSuccessfulTranscriptions,
      results,
      total_urls: urls.length,
    };
  },
});

export { youtubeTranscriptionTool };
