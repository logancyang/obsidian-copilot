/**
 * The response object from Whisper ASR transcription.
 */
export type WhisperASRResponse = {
  /**
   * The language code of the detected or provided language for the transcription.
   * @example "en"
   */
  language: string;

  /**
   * The complete transcription text of the audio.
   * @example "Hey, so this is a voice recording..."
   */
  text: string;

  /**
   * An array of segments, each containing detailed information about a portion of the audio.
   */
  segments: WhisperASRSegment[];
};

/**
 * Detailed information about a specific segment of the audio transcription.
 */
export type WhisperASRSegment = {
  /**
   * A presumed parameter indicating a segment's index or a unique identifier within the audio.
   * @example 1
   */
  segmentIndex: number;

  /**
   * An optional parameter that might represent an offset or buffer start time for the segment.
   * Its precise meaning could be related to the starting position within the audio for processing.
   * @example 3000
   */
  seek: number;

  /**
   * The start time of the segment in seconds.
   * @example 0.0
   */
  start: number;

  /**
   * The end time of the segment in seconds.
   * @example 7.42
   */
  end: number;

  /**
   * The transcribed text for this segment.
   * @example "Hey, so this is a voice recording..."
   */
  text: string;

  /**
   * An array of token IDs used in the segment. These could correspond to specific words or sounds identified by the model.
   */
  tokens: number[];

  /**
   * Temperature used for sampling during the transcription process. Affects the model's creativity and certainty.
   * @example 0.0
   */
  temperature: number;

  /**
   * The average log probability of the generated tokens, indicating the model's confidence in its transcription.
   * @example -0.1514469523998824
   */
  avg_logprob: number;

  /**
   * The compression ratio of the transcription, used to evaluate the repetitiveness or uniqueness of the content.
   * @example 1.5560747663551402
   */
  compression_ratio: number;

  /**
   * The probability that no speech is present in the segment. Used to detect silence or non-speech audio.
   * @example 0.012836405076086521
   */
  no_speech_prob: number;

  /**
   * An array of word-level timestamps, providing detailed timing for each word spoken in the segment.
   */
  words: WhisperASRWordTimestamp[] | null;

  /**
   * The unique identifier for the segment.
   */
  id: number;
};

/**
 * Detailed timing and confidence information for a single word within a segment.
 */
export type WhisperASRWordTimestamp = {
  /**
   * The start time of the word within the segment, in seconds.
   * @example 0.0
   */
  start: number;

  /**
   * The end time of the word within the segment, in seconds.
   * @example 0.56
   */
  end: number;

  /**
   * The word text.
   * @example "Hey,"
   */
  word: string;

  /**
   * The model's confidence in the accuracy of this word transcription.
   * @example 0.941351592540741
   */
  probability: number;
};

export interface components {
  schemas: {
    /**
     * GeneratePresignedResponse
     * @description Response for uploading a file
     */
    GeneratePresignedResponse: {
      /**
       * Url
       * Format: uri
       * @description The URL to POST the file to
       */
      url: string;
      /**
       * Filename
       * @description The filename to use for the file
       */
      filename: string;
    };
    /** TimestampedTextSegment */
    TimestampedTextSegment: {
      /**
       * Start
       * @description Start time of the segment in seconds
       * @example 0
       */
      start: number;
      /**
       * End
       * @description End time of the segment in seconds
       * @example 1
       */
      end: number;
      /**
       * Text
       * @description Text of the segment
       * @example Hello World
       */
      text: string;
    };
    /**
     * TranscriptStatus
     * @description Transcript status
     * @enum {string}
     */
    TranscriptStatus:
      | "pending"
      | "uploaded"
      | "validating"
      | "validated"
      | "transcribing"
      | "transcribed"
      | "complete"
      | "validation_failed"
      | "failed";
    /**
     * TranscriptRating
     * @description An enumeration.
     * @enum {string}
     */
    TranscriptRating: "none" | "positive" | "negative";
    /**
     * TranscriptLanguage
     * @description ISO 639-1 language codes
     * @enum {string}
     */
    TranscriptLanguage:
      | "af"
      | "am"
      | "ar"
      | "as"
      | "az"
      | "ba"
      | "be"
      | "bg"
      | "bn"
      | "bo"
      | "br"
      | "bs"
      | "ca"
      | "cs"
      | "cy"
      | "da"
      | "de"
      | "el"
      | "en"
      | "es"
      | "et"
      | "eu"
      | "fa"
      | "fi"
      | "fo"
      | "fr"
      | "gl"
      | "gu"
      | "ha"
      | "haw"
      | "hi"
      | "hr"
      | "ht"
      | "hu"
      | "hy"
      | "id"
      | "is"
      | "it"
      | "iw"
      | "ja"
      | "jw"
      | "ka"
      | "kk"
      | "km"
      | "kn"
      | "ko"
      | "la"
      | "lb"
      | "ln"
      | "lo"
      | "lt"
      | "lv"
      | "mg"
      | "mi"
      | "mk"
      | "ml"
      | "mn"
      | "mr"
      | "ms"
      | "mt"
      | "my"
      | "ne"
      | "nl"
      | "nn"
      | "no"
      | "oc"
      | "pa"
      | "pl"
      | "ps"
      | "pt"
      | "ro"
      | "ru"
      | "sa"
      | "sd"
      | "si"
      | "sk"
      | "sl"
      | "sn"
      | "so"
      | "sq"
      | "sr"
      | "su"
      | "sv"
      | "sw"
      | "ta"
      | "te"
      | "tg"
      | "th"
      | "tk"
      | "tl"
      | "tr"
      | "tt"
      | "uk"
      | "ur"
      | "uz"
      | "vi"
      | "yi"
      | "yo"
      | "zh";
    /** WebhookSchema */
    WebhookSchema: {
      /**
       * Url
       * @description The URL to POST the JSON transcript to on completion
       */
      url: string;
    };
    /** TranscriptSchema */
    TranscriptSchema: {
      /**
       * Id
       * Format: uuid
       * @description Unique ID for the transcript
       */
      id?: string;
      /**
       * Created
       * Format: date-time
       * @description Time the transcript was created
       */
      created: string;
      /**
       * Updated
       * Format: date-time
       * @description Time the transcript was last updated
       */
      updated: string;
      /**
       * Name
       * @description Name of the transcript
       */
      name?: string;
      /**
       * Validated
       * @description Whether the file has been validated
       * @default false
       */
      validated?: boolean;
      /**
       * Transcribed
       * @description Whether the file has been transcribed
       * @default false
       */
      transcribed?: boolean;
      /**
       * Context
       * @description Transcript context, elaborate on the setting, content, speakers, etc. The model will only consider the last 224 tokens of the string if what's provided is longer.
       */
      context?: string;
      /**
       * Translate
       * @description Whether to translate the transcript to English
       * @default false
       */
      translate?: boolean;
      /**
       * Url
       * @description URL of the file
       * @default https://example.com
       */
      url?: string;
      /**
       * File Mimetype
       * @description Mimetype of file
       */
      file_mimetype?: string;
      /**
       * Duration Seconds
       * @description Duration of the file in seconds
       */
      duration_seconds?: number;
      /**
       * Text Segments
       * @description List of text segments with timestamps
       */
      text_segments: components["schemas"]["TimestampedTextSegment"][];
      /**
       * Text
       * @description Transcript text
       */
      text?: string;
      /**
       * Heading Segments
       * @description An outline of the transcript in the form of timestamped headings
       */
      heading_segments: components["schemas"]["TimestampedTextSegment"][];
      /**
       * Summary
       * @description Transcript summary
       */
      summary?: string;
      /**
       * User Id
       * Format: uuid
       */
      user_id: string;
      /** @description Transcript status */
      status: components["schemas"]["TranscriptStatus"];
      /** @description Transcript rating */
      rating: components["schemas"]["TranscriptRating"];
      /** @description Detected language of the transcript in standard ISO 639-1 */
      language: components["schemas"]["TranscriptLanguage"];
      /**
       * Webhooks
       * @description List of webhooks hit with POST on completion of the transcript
       */
      webhooks: components["schemas"]["WebhookSchema"][];
      /**
       * Keywords
       * @description List of keywords generated from the transcript
       */
      keywords: string[];
    };
    /** CreateTranscriptionRequest */
    CreateTranscriptionRequest: {
      /**
       * Name
       * @description The name of the transcription
       * @example David Attenborough - Planet Earth II - Episode 1 - The Beasts of the Southern Wild
       */
      name?: string;
      /**
       * Url
       * Format: uri
       * @description The url of the audio file to be transcribed.
       * @example https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4
       */
      url: string;
      /**
       * Do Async
       * @description Whether or not to run the transcription asynchronously
       * @default true
       */
      do_async?: boolean;
      /**
       * Webhooks
       * @description Webhooks to be called to update on the status of the transcription
       */
      webhooks?: components["schemas"]["WebhookSchema"][];
      /**
       * Context
       * @description Context to be used for the transcription
       */
      context?: string;
      /**
       * @description The language of the transcription. If this is not provided, the language will be detected automatically
       * @example fa
       */
      language?: components["schemas"]["TranscriptLanguage"];
    };
    /** UpdateTranscriptRequest */
    UpdateTranscriptRequest: {
      /**
       * Name
       * @description The name of the transcript
       * @example David Attenborough - Planet Earth II - Episode 1 - The Beasts of the Southern Wild
       */
      name?: string;
      /**
       * @description The rating of the transcript, positive or negative
       * @example positive
       */
      rating?: components["schemas"]["TranscriptRating"];
    };
    /** APIKeySchema */
    APIKeySchema: {
      /**
       * Id
       * @description The API Key's unique id
       */
      id?: string;
      /**
       * Name
       * @description The API Key's name, user defined
       * @default API Key
       */
      name?: string;
      /**
       * Created
       * Format: date-time
       * @description Time the record was created
       */
      created: string;
      /**
       * Updated
       * Format: date-time
       * @description Time the record was last updated
       */
      updated: string;
      /**
       * Secret
       * @description The API key's secret. Only returned when creating a new API key.
       */
      secret?: string;
      /**
       * User Id
       * Format: uuid
       */
      user_id: string;
    };
    /** CreateAPIKeyResponse */
    CreateAPIKeyResponse: {
      /**
       * Id
       * @description The API Key's unique id
       */
      id?: string;
      /**
       * Name
       * @description The API Key's name, user defined
       * @default API Key
       */
      name?: string;
      /**
       * Created
       * Format: date-time
       * @description Time the record was created
       */
      created: string;
      /**
       * Updated
       * Format: date-time
       * @description Time the record was last updated
       */
      updated: string;
      /**
       * Secret
       * @description The secret key string to use in plugins and HTTP headers for Swiftink authentication
       */
      secret: string;
      /**
       * User Id
       * Format: uuid
       */
      user_id: string;
    };
    /** UpdateAPIKeyRequest */
    UpdateAPIKeyRequest: {
      /**
       * Name
       * @description The name of the API Key
       */
      name?: string;
    };
    /** CreateCheckoutSessionResponse */
    CreateCheckoutSessionResponse: {
      /**
       * Url
       * @description The url to redirect the user to to complete the checkout process
       */
      url: string;
    };
    /**
     * PriceOptions
     * @description An enumeration.
     * @enum {string}
     */
    PriceOptions:
      | "individual_monthly"
      | "individual_yearly"
      | "professional_monthly"
      | "professional_yearly"
      | "business_monthly"
      | "business_yearly";
    /** CreateCheckoutSessionRequest */
    CreateCheckoutSessionRequest: {
      /** @description The price to create a checkout session for */
      price: components["schemas"]["PriceOptions"];
    };
    /** CreatePortalSessionResponse */
    CreatePortalSessionResponse: {
      /**
       * Url
       * @description The url to redirect the user to to manage their account
       */
      url: string;
    };
    /**
     * SwiftinkSubscriptionTiers
     * @description An enumeration.
     * @enum {string}
     */
    SwiftinkSubscriptionTiers: "free" | "individual" | "professional" | "business";
    /** ProfileSchema */
    ProfileSchema: {
      /** Name */
      name?: string;
      /** Profile Picture */
      profile_picture?: string;
      /**
       * Created
       * Format: date-time
       */
      created: string;
      /**
       * Updated
       * Format: date-time
       */
      updated: string;
      /** Email */
      email: string;
      /**
       * User Id
       * Format: uuid
       */
      user_id: string;
      subscription_tier: components["schemas"]["SwiftinkSubscriptionTiers"];
    };
    /** CreateUserRequest */
    CreateUserRequest: {
      /**
       * Email
       * Format: email
       */
      email: string;
      /** Password */
      password: string;
      /** Name */
      name: string;
    };
    /** UpdateProfileRequest */
    UpdateProfileRequest: {
      /** Name */
      name?: string;
      /**
       * Profile Picture
       * Format: uri
       */
      profile_picture?: string;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
