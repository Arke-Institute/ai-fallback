/**
 * Manual test for fallback behavior.
 * Run: npx tsx test.ts
 */
import { createFallbackModel, AllModelsExhaustedError } from './src/index.js';
import { APICallError } from '@ai-sdk/provider';

// Helper to create a mock LanguageModelV3
function mockModel(
  id: string,
  behavior: 'succeed' | '429' | '500' | 'network-error'
) {
  return {
    specificationVersion: 'v3' as const,
    provider: 'mock',
    modelId: id,
    supportedUrls: {},

    async doGenerate(options: any) {
      console.log(`  [${id}] doGenerate called`);

      if (behavior === '429') {
        throw new APICallError({
          message: `Rate limited on ${id}`,
          url: 'https://mock.api/v1/chat',
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
          responseBody: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
        });
      }

      if (behavior === '500') {
        throw new APICallError({
          message: `Server error on ${id}`,
          url: 'https://mock.api/v1/chat',
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: true,
        });
      }

      if (behavior === 'network-error') {
        throw new TypeError('fetch failed');
      }

      return {
        content: [{ type: 'text', text: `Response from ${id}` }],
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
        warnings: [],
      };
    },

    async doStream(options: any) {
      console.log(`  [${id}] doStream called`);

      if (behavior === '429') {
        throw new APICallError({
          message: `Rate limited on ${id}`,
          url: 'https://mock.api/v1/chat',
          requestBodyValues: {},
          statusCode: 429,
          isRetryable: true,
          responseBody: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
        });
      }

      if (behavior === '500') {
        throw new APICallError({
          message: `Server error on ${id}`,
          url: 'https://mock.api/v1/chat',
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: true,
        });
      }

      if (behavior === 'network-error') {
        throw new TypeError('fetch failed');
      }

      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text', text: `Streamed from ${id}` });
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5 } });
            controller.close();
          },
        }),
      };
    },
  } as any;
}

async function test(
  name: string,
  fn: () => Promise<void>
) {
  console.log(`\n--- TEST: ${name} ---`);
  try {
    await fn();
    console.log(`  PASS`);
  } catch (e) {
    console.log(`  FAIL: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  // Test 1: Primary succeeds — no fallback
  await test('Primary succeeds, no fallback triggered', async () => {
    const model = createFallbackModel({
      models: [mockModel('primary', 'succeed'), mockModel('backup', 'succeed')],
      onFallback: () => console.log('  [UNEXPECTED] Fallback triggered!'),
    });
    const result = await model.doGenerate({ prompt: [] } as any);
    console.log(`  Result: ${(result.content[0] as any).text}`);
  });

  // Test 2: Primary 429 → fallback to second model
  await test('Primary 429 → fallback to second model', async () => {
    const model = createFallbackModel({
      models: [mockModel('rate-limited', '429'), mockModel('backup', 'succeed')],
      onFallback: ({ failedModel, nextModel, error }) => {
        console.log(
          `  Fallback: ${failedModel.modelId} → ${nextModel.modelId} (${(error as Error).message})`
        );
      },
    });
    const result = await model.doGenerate({ prompt: [] } as any);
    console.log(`  Result: ${(result.content[0] as any).text}`);
  });

  // Test 3: Primary 500 with retry → then fallback
  await test('Primary 500 retries once, then falls back', async () => {
    const model = createFallbackModel({
      models: [mockModel('unstable', '500'), mockModel('backup', 'succeed')],
      maxRetriesPerModel: 1,
      baseDelayMs: 100, // fast for testing
      onRetry: ({ model: m, attempt, delayMs }) => {
        console.log(`  Retry: ${m.modelId} attempt ${attempt}, delay ${delayMs}ms`);
      },
      onFallback: ({ failedModel, nextModel }) => {
        console.log(`  Fallback: ${failedModel.modelId} → ${nextModel.modelId}`);
      },
    });
    const result = await model.doGenerate({ prompt: [] } as any);
    console.log(`  Result: ${(result.content[0] as any).text}`);
  });

  // Test 4: All models 429 → AllModelsExhaustedError
  await test('All models 429 → AllModelsExhaustedError', async () => {
    const model = createFallbackModel({
      models: [
        mockModel('model-a', '429'),
        mockModel('model-b', '429'),
        mockModel('model-c', '429'),
      ],
      onFallback: ({ failedModel, nextModel }) => {
        console.log(`  Fallback: ${failedModel.modelId} → ${nextModel.modelId}`);
      },
    });
    try {
      await model.doGenerate({ prompt: [] } as any);
      console.log('  [UNEXPECTED] Should have thrown');
    } catch (e) {
      if (e instanceof AllModelsExhaustedError) {
        console.log(`  Caught AllModelsExhaustedError with ${e.errors.length} errors`);
      } else {
        throw e;
      }
    }
  });

  // Test 5: doStream fallback (429)
  await test('doStream: Primary 429 → fallback to second model', async () => {
    const model = createFallbackModel({
      models: [mockModel('rate-limited', '429'), mockModel('backup', 'succeed')],
      onFallback: ({ failedModel, nextModel }) => {
        console.log(`  Fallback: ${failedModel.modelId} → ${nextModel.modelId}`);
      },
    });
    const result = await model.doStream({ prompt: [] } as any);
    const reader = result.stream.getReader();
    const chunk = await reader.read();
    console.log(`  Stream chunk: ${JSON.stringify(chunk.value)}`);
  });

  // Test 6: Chain of 3 — first two fail, third succeeds
  await test('Chain of 3: model-a(429) → model-b(500) → model-c(ok)', async () => {
    const model = createFallbackModel({
      models: [
        mockModel('model-a', '429'),
        mockModel('model-b', '500'),
        mockModel('model-c', 'succeed'),
      ],
      onFallback: ({ failedModel, nextModel, error }) => {
        console.log(
          `  Fallback: ${failedModel.modelId} → ${nextModel.modelId} (${(error as Error).message})`
        );
      },
    });
    const result = await model.doGenerate({ prompt: [] } as any);
    console.log(`  Result: ${(result.content[0] as any).text}`);
  });

  console.log('\n--- ALL TESTS COMPLETE ---\n');
}

main().catch(console.error);
