import { APICallError } from '@ai-sdk/provider';
import type { ErrorClassification } from './types.js';

/**
 * Default error classifier for the fallback model.
 *
 * - 429 (rate limited) → fallback to next model (separate quotas)
 * - 5xx (server error) → retry same model (transient)
 * - isRetryable flag   → retry same model
 * - 4xx (client error) → throw immediately (fatal)
 * - Network errors     → retry same model
 * - Unknown            → throw immediately
 */
export function defaultShouldRetry(error: unknown): ErrorClassification {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;

    // Rate limited — try next model (they likely have separate quotas)
    if (status === 429) {
      return { action: 'fallback' };
    }

    // Server errors — retry same model (transient)
    if (status !== undefined && status >= 500) {
      return { action: 'retry' };
    }

    // SDK's own retryable classification
    if (error.isRetryable) {
      return { action: 'retry' };
    }

    // Client errors (400, 401, 403, etc.) — fatal
    return { action: 'throw' };
  }

  // Network errors (fetch failed, DNS, etc.)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return { action: 'retry' };
  }

  // Unknown errors — throw (safe default)
  return { action: 'throw' };
}
