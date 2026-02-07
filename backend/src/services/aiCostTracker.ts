/**
 * AI Cost Tracker
 *
 * Logs Claude API usage with estimated costs for monitoring and alerting.
 * Uses structured logging so costs can be queried from log aggregation tools.
 *
 * @module services/aiCostTracker
 */

import { logger } from '../utils/logger.js';

const aiCostLogger = logger.createServiceLogger('AICost');

// Token pricing (update when Anthropic changes pricing)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  'claude-sonnet-4-5-20250929': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};

interface AIUsageInput {
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  userId: string;
}

/**
 * Log AI API usage with estimated cost.
 * Call after every successful Claude API response.
 */
export function trackAIUsage(record: AIUsageInput): void {
  const pricing = PRICING[record.model] || PRICING['claude-sonnet-4-5-20250929'];
  const estimatedCostUsd = (record.inputTokens * pricing.input) + (record.outputTokens * pricing.output);

  aiCostLogger.info('AI API usage', {
    endpoint: record.endpoint,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedCostUsd: estimatedCostUsd.toFixed(6),
    userId: record.userId,
  });
}
