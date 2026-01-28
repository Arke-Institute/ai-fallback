import type { LanguageModelV3 } from '@ai-sdk/provider';

/**
 * Classification of how an error should be handled.
 */
export type ErrorClassification =
  | { action: 'retry' }     // Retry same model (if retries remain), then fallback
  | { action: 'fallback' }  // Skip retries, immediately try next model
  | { action: 'throw' };    // Fatal — do not retry or fallback

/**
 * Event emitted when retrying the same model.
 */
export interface RetryEvent {
  /** Index of the model in the chain */
  modelIndex: number;
  /** The model being retried */
  model: LanguageModelV3;
  /** 1-indexed retry attempt number */
  attempt: number;
  /** Maximum retries configured for this model */
  maxRetries: number;
  /** The error that triggered the retry */
  error: unknown;
  /** Delay in ms before the retry */
  delayMs: number;
}

/**
 * Event emitted when falling back to the next model.
 */
export interface FallbackEvent {
  /** Index of the model that failed */
  failedModelIndex: number;
  /** The model that failed */
  failedModel: LanguageModelV3;
  /** Index of the next model to try */
  nextModelIndex: number;
  /** The next model to try */
  nextModel: LanguageModelV3;
  /** The error that caused the fallback */
  error: unknown;
  /** How many attempts were made on the failed model */
  totalAttempts: number;
}

/**
 * Event emitted on any model error (before classification).
 */
export interface ErrorEvent {
  /** Index of the model in the chain */
  modelIndex: number;
  /** The model that errored */
  model: LanguageModelV3;
  /** The error */
  error: unknown;
  /** How the error was classified */
  classification: ErrorClassification;
}

/**
 * Configuration for createFallbackModel.
 */
export interface FallbackModelConfig {
  /**
   * Ordered list of models. First model is primary; rest are fallbacks.
   * Minimum 1 model required.
   */
  models: LanguageModelV3[];

  /**
   * Maximum retries on the SAME model before moving to the next.
   * Default: 0 (immediately fallback on retryable error).
   */
  maxRetriesPerModel?: number;

  /**
   * Base delay in ms for exponential backoff between retries on the same model.
   * Actual delay = baseDelay * 2^attempt (with jitter).
   * Default: 1000
   */
  baseDelayMs?: number;

  /**
   * Maximum delay in ms for exponential backoff.
   * Default: 30000
   */
  maxDelayMs?: number;

  /**
   * Classify whether an error should trigger retry, fallback, or be thrown.
   * Default: retries on 5xx, fallbacks on 429, throws on 4xx client errors.
   */
  shouldRetry?: (error: unknown) => ErrorClassification;

  /** Called when a retry is attempted on the same model. */
  onRetry?: (event: RetryEvent) => void;

  /** Called when falling back to the next model. */
  onFallback?: (event: FallbackEvent) => void;

  /** Called when any model produces an error (before classification). */
  onError?: (event: ErrorEvent) => void;

  /**
   * Provider ID for the composite model.
   * Default: 'fallback'
   */
  provider?: string;

  /**
   * Model ID for the composite model.
   * Default: auto-generated from constituent model IDs joined with ' -> '
   */
  modelId?: string;
}
