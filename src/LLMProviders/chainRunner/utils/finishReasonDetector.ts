export interface FinishReasonResult {
  wasTruncated: boolean;
  message: string | null;
}

export function detectTruncation(chunk: {
  response_metadata?: Record<string, unknown>;
}): FinishReasonResult {
  const metadata = chunk.response_metadata || {};

  if (metadata.finish_reason === "length") {
    return {
      wasTruncated: true,
      message: "Response truncated due to token limit",
    };
  }

  if (metadata.stop_reason === "max_tokens") {
    return {
      wasTruncated: true,
      message: "Response truncated due to max_tokens limit",
    };
  }

  if (metadata.finishReason === "MAX_TOKENS" || metadata.finish_reason === "MAX_TOKENS") {
    return {
      wasTruncated: true,
      message: "Response truncated due to MAX_TOKENS limit",
    };
  }

  return {
    wasTruncated: false,
    message: null,
  };
}

export function extractTokenUsage(chunk: {
  response_metadata?: Record<string, unknown>;
  usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | null {
  const metadata = chunk.response_metadata || {};

  if (metadata.tokenUsage) {
    const tu = metadata.tokenUsage as {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    return {
      inputTokens: tu.promptTokens,
      outputTokens: tu.completionTokens,
      totalTokens: tu.totalTokens,
    };
  }

  if (metadata.usage) {
    const u = metadata.usage as {
      input_tokens?: number;
      inputTokens?: number;
      inputTokenCount?: number;
      prompt_tokens?: number;
      output_tokens?: number;
      outputTokens?: number;
      outputTokenCount?: number;
      completion_tokens?: number;
      total_tokens?: number;
      totalTokens?: number;
    };
    return {
      inputTokens: u.input_tokens || u.inputTokens || u.inputTokenCount || u.prompt_tokens,
      outputTokens: u.output_tokens || u.outputTokens || u.outputTokenCount || u.completion_tokens,
      totalTokens:
        u.total_tokens ||
        u.totalTokens ||
        (u.input_tokens || u.inputTokenCount || 0) + (u.output_tokens || u.outputTokenCount || 0),
    };
  }

  if (chunk.usage_metadata) {
    return {
      inputTokens: chunk.usage_metadata.input_tokens,
      outputTokens: chunk.usage_metadata.output_tokens,
      totalTokens: chunk.usage_metadata.total_tokens,
    };
  }

  return null;
}
