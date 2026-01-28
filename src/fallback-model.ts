import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import type { FallbackModelConfig } from './types.js';
import { AllModelsExhaustedError } from './errors.js';
import { defaultShouldRetry } from './error-classifier.js';
import { calculateDelay, sleep, mergeSupportedUrls } from './utils.js';

/**
 * Create a fallback model that implements LanguageModelV3.
 *
 * Wraps an ordered list of models and automatically falls back on
 * retryable errors (rate limits, server errors). Works with any
 * AI SDK provider — Gemini, DeepInfra, OpenAI, Anthropic, etc.
 *
 * @example
 * ```typescript
 * import { createFallbackModel } from '@arke-institute/ai-fallback';
 *
 * const model = createFallbackModel({
 *   models: [
 *     google('gemini-3-flash-preview'),
 *     google('gemini-2.5-flash'),
 *     deepinfra('meta-llama/Llama-3.3-70B-Instruct'),
 *   ],
 *   onFallback: ({ failedModel, nextModel }) => {
 *     console.log(`Fallback: ${failedModel.modelId} → ${nextModel.modelId}`);
 *   },
 * });
 *
 * const result = streamText({ model, messages, tools });
 * ```
 */
export function createFallbackModel(config: FallbackModelConfig): LanguageModelV3 {
  const {
    models,
    maxRetriesPerModel = 0,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = defaultShouldRetry,
    onRetry,
    onFallback,
    onError,
    provider = 'fallback',
    modelId = models.map((m) => m.modelId).join(' -> '),
  } = config;

  if (models.length === 0) {
    throw new Error('createFallbackModel requires at least one model');
  }

  const supportedUrls = mergeSupportedUrls(models);

  async function executeWithFallback<T>(
    operation: (model: LanguageModelV3) => PromiseLike<T>,
    options: LanguageModelV3CallOptions
  ): Promise<T> {
    const errors: Array<{ model: LanguageModelV3; error: unknown }> = [];

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
      const model = models[modelIndex];

      for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
        // Check abort signal before each attempt
        if (options.abortSignal?.aborted) {
          throw options.abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
        }

        try {
          return await operation(model);
        } catch (error) {
          const classification = shouldRetry(error);

          onError?.({
            modelIndex,
            model,
            error,
            classification,
          });

          // Fatal error — throw immediately
          if (classification.action === 'throw') {
            throw error;
          }

          errors.push({ model, error });

          // Retry same model with backoff (if retries remain and action is 'retry')
          if (classification.action === 'retry' && attempt < maxRetriesPerModel) {
            const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);

            onRetry?.({
              modelIndex,
              model,
              attempt: attempt + 1,
              maxRetries: maxRetriesPerModel,
              error,
              delayMs: delay,
            });

            await sleep(delay, options.abortSignal);
            continue;
          }

          // Move to next model
          if (modelIndex < models.length - 1) {
            onFallback?.({
              failedModelIndex: modelIndex,
              failedModel: model,
              nextModelIndex: modelIndex + 1,
              nextModel: models[modelIndex + 1],
              error,
              totalAttempts: attempt + 1,
            });
          }

          break; // Break inner loop, continue outer loop to next model
        }
      }
    }

    throw new AllModelsExhaustedError(errors);
  }

  return {
    specificationVersion: 'v3',
    provider,
    modelId,
    supportedUrls,

    doGenerate(
      options: LanguageModelV3CallOptions
    ): PromiseLike<LanguageModelV3GenerateResult> {
      return executeWithFallback((model) => model.doGenerate(options), options);
    },

    doStream(
      options: LanguageModelV3CallOptions
    ): PromiseLike<LanguageModelV3StreamResult> {
      return executeWithFallback((model) => model.doStream(options), options);
    },
  };
}
