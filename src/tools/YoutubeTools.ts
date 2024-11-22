import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const simpleYoutubeTranscriptionTool = tool(
  async ({ url, brevilabsClient }: { url: string; brevilabsClient: BrevilabsClient }) => {
    try {
      const response = await brevilabsClient.youtube4llm(url);

      // Check if transcript is empty
      if (!response.response.transcript) {
        return JSON.stringify({
          success: false,
          message:
            "Transcript not available. Only English videos with the auto transcript option turned on are supported at the moment",
        });
      }

      const transcriptResultPrompt = `Please correct any typo or obvious mistranscription in the following youtube transcript, and return the corrected version, with an empty line between each sentence. Return the TRANSCRIPT ONLY, WITHOUT any other text. If the transcript is empty, return the provided message.\n\n`;
      return (
        transcriptResultPrompt +
        JSON.stringify({
          success: true,
          transcript: response.response.transcript,
          elapsed_time_ms: response.elapsed_time_ms,
        })
      );
    } catch (error) {
      console.error(`Error transcribing YouTube video ${url}:`, error);
      return JSON.stringify({
        success: false,
        message: "An error occurred while transcribing the YouTube video.",
      });
    }
  },
  {
    name: "youtubeTranscription",
    description: "Get the transcript of a YouTube video",
    schema: z.object({
      url: z.string().describe("The YouTube video URL"),
      brevilabsClient: z.any().describe("The BrevilabsClient instance"),
    }),
  }
);

export { simpleYoutubeTranscriptionTool };
