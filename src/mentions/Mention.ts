import { ImageProcessor } from "@/imageProcessing/imageProcessor";
import { BrevilabsClient, Url4llmResponse } from "@/LLMProviders/brevilabsClient";
import { err2String, isYoutubeUrl } from "@/utils";
import { logError } from "@/logger";

export interface MentionData {
  type: string;
  original: string;
  processed?: string;
  error?: string;
}

export class Mention {
  private static instance: Mention;
  private mentions: Map<string, MentionData>;
  private brevilabsClient: BrevilabsClient;

  private constructor() {
    this.mentions = new Map();
    this.brevilabsClient = BrevilabsClient.getInstance();
  }

  static getInstance(): Mention {
    if (!Mention.instance) {
      Mention.instance = new Mention();
    }
    return Mention.instance;
  }

  extractAllUrls(text: string): string[] {
    // Match URLs and trim any trailing commas
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    return (text.match(urlRegex) || [])
      .map((url) => url.replace(/,+$/, "")) // Remove trailing commas
      .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates
  }

  extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    return (text.match(urlRegex) || [])
      .map((url) => url.replace(/,+$/, ""))
      .filter((url, index, self) => self.indexOf(url) === index)
      .filter((url) => !isYoutubeUrl(url));
  }

  async processUrl(url: string): Promise<Url4llmResponse & { error?: string }> {
    try {
      return await this.brevilabsClient.url4llm(url);
    } catch (error) {
      const msg = err2String(error);
      logError(`Error processing URL ${url}: ${msg}`);
      return { response: url, elapsed_time_ms: 0, error: msg };
    }
  }

  /**
   * Process a list of URLs directly for url4llm endpoint.
   *
   * @param urls Array of URLs to process
   * @returns Processed URL context and any errors
   */
  async processUrlList(urls: string[]): Promise<{
    urlContext: string;
    imageUrls: string[];
    processedErrorUrls: Record<string, string>;
  }> {
    let urlContext = "";
    const imageUrls: string[] = [];
    const processedErrorUrls: Record<string, string> = {};

    // Return empty string if no URLs to process
    if (urls.length === 0) {
      return { urlContext, imageUrls, processedErrorUrls };
    }

    // Process all URLs concurrently
    const processPromises = urls.map(async (url) => {
      // Check if it's an image URL
      if (await ImageProcessor.isImageUrl(url, app.vault)) {
        imageUrls.push(url);
        return null;
      }

      if (!this.mentions.has(url)) {
        const processed = await this.processUrl(url);
        this.mentions.set(url, {
          type: "url",
          original: url,
          processed: processed.response,
          error: processed.error,
        });
      }
      return this.mentions.get(url);
    });

    const processedUrls = await Promise.all(processPromises);

    // Append all processed content
    processedUrls.forEach((urlData) => {
      if (urlData?.processed) {
        urlContext += `\n\n<url_content>\n<url>${urlData.original}</url>\n<content>\n${urlData.processed}\n</content>\n</url_content>`;
      }

      if (urlData?.error) {
        processedErrorUrls[urlData.original] = urlData.error;
      }
    });

    return { urlContext, imageUrls, processedErrorUrls };
  }

  /**
   * Process URLs from user input text for url4llm endpoint.
   *
   * IMPORTANT: This method should ONLY be called with the user's direct chat input,
   * NOT with content from context notes. This ensures url4llm is only called for
   * URLs explicitly typed by the user, similar to YouTube transcript processing.
   *
   * @param text The user's chat input text
   * @returns Processed URL context and any errors
   */
  async processUrls(text: string): Promise<{
    urlContext: string;
    imageUrls: string[];
    processedErrorUrls: Record<string, string>;
  }> {
    const urls = this.extractUrls(text);
    let urlContext = "";
    const imageUrls: string[] = [];
    const processedErrorUrls: Record<string, string> = {};

    // Return empty string if no URLs to process
    if (urls.length === 0) {
      return { urlContext, imageUrls, processedErrorUrls };
    }

    // Process all URLs concurrently
    const processPromises = urls.map(async (url) => {
      // Check if it's an image URL
      if (await ImageProcessor.isImageUrl(url, app.vault)) {
        imageUrls.push(url);
        return null;
      }

      if (!this.mentions.has(url)) {
        const processed = await this.processUrl(url);
        this.mentions.set(url, {
          type: "url",
          original: url,
          processed: processed.response,
          error: processed.error,
        });
      }
      return this.mentions.get(url);
    });

    const processedUrls = await Promise.all(processPromises);

    // Append all processed content
    processedUrls.forEach((urlData) => {
      if (urlData?.processed) {
        urlContext += `\n\n<url_content>\n<url>${urlData.original}</url>\n<content>\n${urlData.processed}\n</content>\n</url_content>`;
      }

      if (urlData?.error) {
        processedErrorUrls[urlData.original] = urlData.error;
      }
    });

    return { urlContext, imageUrls, processedErrorUrls };
  }

  getMentions(): Map<string, MentionData> {
    return this.mentions;
  }

  clearMentions(): void {
    this.mentions.clear();
  }
}
