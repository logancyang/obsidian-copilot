import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { extractAllYoutubeUrls } from "@/utils";
import { z } from "zod";
import { createTool } from "./SimpleTool";

// Maximum input length to prevent potential DoS attacks
const MAX_USER_MESSAGE_LENGTH = 50000; // Maximum number of characters

interface YouTubeHandlerArgs {
  _userMessageContent: string;
}

const youtubeTranscriptionTool = createTool({
  name: "youtubeTranscription",
  description: "Get transcripts of YouTube videos when the user provides YouTube URLs",
  schema: z.object({}), // Empty schema - the tool will receive _userMessageContent internally
  isPlusOnly: true,
  requiresUserMessageContent: true,
  handler: async (args: YouTubeHandlerArgs) => {
    // The _userMessageContent is injected by the tool execution system
    const { _userMessageContent } = args;

    // Input validation
    if (typeof _userMessageContent !== "string") {
      return JSON.stringify({
        success: false,
        message: "Invalid input: User message must be a string",
      });
    }

    if (_userMessageContent.length > MAX_USER_MESSAGE_LENGTH) {
      return JSON.stringify({
        success: false,
        message: `Input too long: Maximum allowed length is ${MAX_USER_MESSAGE_LENGTH} characters`,
      });
    }

    // Extract YouTube URLs only from the user's message
    const urls = extractAllYoutubeUrls(_userMessageContent);

    if (urls.length === 0) {
      return JSON.stringify({
        success: false,
        message:
          "No YouTube URLs found in the user prompt. URLs must be in the user prompt instead of the context notes.",
      });
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

    return JSON.stringify({
      success: hasSuccessfulTranscriptions,
      results,
      total_urls: urls.length,
    });
  },
});

export { youtubeTranscriptionTool };
