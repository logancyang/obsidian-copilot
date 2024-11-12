export interface MentionData {
  type: string;
  original: string;
  processed?: string;
}

interface BrevilabsResponse {
  response: any;
  elapsed_time_ms: number;
}

export class Mention {
  private static instance: Mention;
  private mentions: Map<string, MentionData>;
  private licenseKey: string;

  private constructor(licenseKey: string) {
    this.mentions = new Map();
    this.licenseKey = licenseKey;
  }

  static getInstance(licenseKey: string): Mention {
    if (!Mention.instance) {
      Mention.instance = new Mention(licenseKey);
    }
    return Mention.instance;
  }

  // TODO: Need to distinguish between normal URLs and youtube links
  extractUrls(text: string): string[] {
    // Match URLs and trim any trailing commas
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    return (text.match(urlRegex) || [])
      .map((url) => url.replace(/,+$/, "")) // Remove trailing commas
      .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates
  }

  async processUrl(url: string): Promise<BrevilabsResponse> {
    try {
      const response = await fetch("https://api.brevilabs.com/v1/url4llm", {
        method: "POST",
        body: JSON.stringify({ url }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.licenseKey}`,
        },
      });
      const data: BrevilabsResponse = await response.json();
      return data;
    } catch (error) {
      console.error(`Error processing URL ${url}:`, error);
      return { response: url, elapsed_time_ms: 0 };
    }
  }

  async processMentions(text: string): Promise<string> {
    const urls = this.extractUrls(text);
    let processedText = text;

    // Return immediately if no URLs to process
    if (urls.length === 0) {
      return processedText;
    }

    // Process all URLs concurrently
    const processPromises = urls.map(async (url) => {
      if (!this.mentions.has(url)) {
        const processed = await this.processUrl(url);
        this.mentions.set(url, {
          type: "url",
          original: url,
          processed: processed.response,
        });
      }
      return this.mentions.get(url);
    });

    const processedMentions = await Promise.all(processPromises);

    // Append all processed content
    processedMentions.forEach((mentionData) => {
      if (mentionData?.processed) {
        processedText += `\n\nContent from ${mentionData.original}:\n${mentionData.processed}`;
      }
    });

    return processedText;
  }

  getMentions(): Map<string, MentionData> {
    return this.mentions;
  }

  clearMentions(): void {
    this.mentions.clear();
  }
}
