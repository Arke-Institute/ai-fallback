import type { LanguageModelV3 } from '@ai-sdk/provider';

/**
 * Exponential backoff with jitter.
 * delay = min(maxDelay, baseDelay * 2^attempt) * jitter(0.5 - 1.0)
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.round(exponential * jitter);
}

/**
 * Sleep that respects abort signals.
 * Rejects immediately if the signal is already aborted or fires during the delay.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Merge supportedUrls from all models (union).
 * If any model supports a URL pattern, the fallback model supports it.
 */
export async function mergeSupportedUrls(
  models: LanguageModelV3[]
): Promise<Record<string, RegExp[]>> {
  const allUrls = await Promise.all(models.map((m) => m.supportedUrls));
  const merged: Record<string, RegExp[]> = {};

  for (const urls of allUrls) {
    for (const [mediaType, patterns] of Object.entries(urls)) {
      if (!merged[mediaType]) {
        merged[mediaType] = [];
      }
      merged[mediaType].push(...patterns);
    }
  }

  return merged;
}
