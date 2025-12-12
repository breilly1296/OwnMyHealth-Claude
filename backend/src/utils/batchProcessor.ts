/**
 * Batch Processor Utility
 *
 * Provides controlled concurrent processing to prevent
 * connection pool exhaustion and memory spikes.
 */

/**
 * Process items in batches with controlled concurrency
 *
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param batchSize - Number of items to process concurrently (default: 20)
 * @returns Promise resolving to array of processed results
 *
 * @example
 * ```typescript
 * const decrypted = await processBatch(
 *   biomarkers,
 *   (b) => toResponse(b, userSalt),
 *   20
 * );
 * ```
 */
export async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 20
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Process items in batches with error handling per item
 *
 * Returns both successful results and errors, allowing partial success.
 *
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param batchSize - Number of items to process concurrently (default: 20)
 * @returns Promise resolving to object with results and errors
 */
export async function processBatchWithErrors<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 20
): Promise<{
  results: R[];
  errors: Array<{ index: number; item: T; error: Error }>;
}> {
  const results: R[] = [];
  const errors: Array<{ index: number; item: T; error: Error }> = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchPromises = batch.map(async (item, batchIndex) => {
      const globalIndex = i + batchIndex;
      try {
        const result = await processor(item);
        return { success: true as const, result, index: globalIndex };
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof Error ? err : new Error(String(err)),
          item,
          index: globalIndex,
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      if (result.success) {
        results.push(result.result);
      } else {
        errors.push({
          index: result.index,
          item: result.item,
          error: result.error,
        });
      }
    }
  }

  return { results, errors };
}
