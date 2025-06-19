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
