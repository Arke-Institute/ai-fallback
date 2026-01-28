import type { LanguageModelV3 } from '@ai-sdk/provider';

/**
 * Error thrown when all models in the fallback chain have been exhausted.
 * Contains the individual errors from each model for diagnostics.
 */
export class AllModelsExhaustedError extends Error {
  readonly errors: Array<{ model: LanguageModelV3; error: unknown }>;

  constructor(errors: Array<{ model: LanguageModelV3; error: unknown }>) {
    const summary = errors
      .map(
        (e, i) =>
          `  [${i}] ${e.model.provider}/${e.model.modelId}: ${e.error instanceof Error ? e.error.message : String(e.error)}`
      )
      .join('\n');
    super(`All fallback models exhausted:\n${summary}`);
    this.name = 'AllModelsExhaustedError';
    this.errors = errors;
  }
}
