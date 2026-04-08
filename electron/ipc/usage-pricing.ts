// Model pricing lookup table for local cost estimation.
// Last updated: 2026-04-07

type TokenUsageData = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

type PricingEntry = {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
};

// Prices in USD per 1M tokens. Approximate public pricing.
const PRICING_TABLE: Record<string, PricingEntry> = {
  // Anthropic
  'claude-opus-4': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  'claude-sonnet-4': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  'claude-3.5-sonnet': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  'claude-3.5-haiku': { inputPer1M: 0.8, outputPer1M: 4, cacheReadPer1M: 0.08, cacheWritePer1M: 1 },
  'claude-3-opus': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  'claude-3-sonnet': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25, cacheReadPer1M: 0.03, cacheWritePer1M: 0.3 },
  // OpenAI
  'gpt-5': { inputPer1M: 10, outputPer1M: 30 },
  'gpt-5.4': { inputPer1M: 10, outputPer1M: 30 },
  'gpt-5.4-pro': { inputPer1M: 30, outputPer1M: 120 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'o3': { inputPer1M: 10, outputPer1M: 40 },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  'o4-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  // Google
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
};

// Prefix patterns tried in order of specificity for fuzzy matching
const PREFIX_PATTERNS: Array<{ prefix: string; key: string }> = [
  { prefix: 'claude-opus-4', key: 'claude-opus-4' },
  { prefix: 'claude-sonnet-4', key: 'claude-sonnet-4' },
  { prefix: 'claude-3.5-sonnet', key: 'claude-3.5-sonnet' },
  { prefix: 'claude-3.5-haiku', key: 'claude-3.5-haiku' },
  { prefix: 'claude-3-opus', key: 'claude-3-opus' },
  { prefix: 'claude-3-sonnet', key: 'claude-3-sonnet' },
  { prefix: 'claude-3-haiku', key: 'claude-3-haiku' },
  { prefix: 'gpt-5.4-pro', key: 'gpt-5.4-pro' },
  { prefix: 'gpt-5.4', key: 'gpt-5.4' },
  { prefix: 'gpt-5', key: 'gpt-5' },
  { prefix: 'gpt-4.1-mini', key: 'gpt-4.1-mini' },
  { prefix: 'gpt-4.1', key: 'gpt-4.1' },
  { prefix: 'gpt-4o-mini', key: 'gpt-4o-mini' },
  { prefix: 'gpt-4o', key: 'gpt-4o' },
  { prefix: 'o4-mini', key: 'o4-mini' },
  { prefix: 'o3-mini', key: 'o3-mini' },
  { prefix: 'o3', key: 'o3' },
  { prefix: 'gemini-2.5-pro', key: 'gemini-2.5-pro' },
  { prefix: 'gemini-2.5-flash', key: 'gemini-2.5-flash' },
  { prefix: 'gemini-2.0-flash', key: 'gemini-2.0-flash' },
  { prefix: 'gemini-1.5-pro', key: 'gemini-1.5-pro' },
  { prefix: 'gemini-1.5-flash', key: 'gemini-1.5-flash' },
];

function normalizeModelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(anthropic\.|openai\/|azure\/|google\/|models\/)/, '')
    .replace(/:.*$/, '')
    .replace(/-latest$/, '')
    .replace(/[-_\s]+/g, '-');
}

export function lookupPricing(modelName: string): PricingEntry | null {
  const normalized = normalizeModelName(modelName);

  // Exact match
  if (PRICING_TABLE[normalized]) return PRICING_TABLE[normalized];

  // Prefix match
  for (const { prefix, key } of PREFIX_PATTERNS) {
    if (normalized.startsWith(prefix)) return PRICING_TABLE[key];
  }

  // Keyword fallback (e.g. "my-custom-opus-deployment" -> opus pricing)
  if (normalized.includes('opus')) return PRICING_TABLE['claude-opus-4'];
  if (normalized.includes('sonnet')) return PRICING_TABLE['claude-sonnet-4'];
  if (normalized.includes('haiku')) return PRICING_TABLE['claude-3.5-haiku'];

  return null;
}

export function estimateCost(modelName: string, usage: TokenUsageData): number {
  const pricing = lookupPricing(modelName);
  if (!pricing) return 0;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
  const cacheReadCost = pricing.cacheReadPer1M
    ? (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M
    : 0;
  const cacheWriteCost = pricing.cacheWritePer1M
    ? (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePer1M
    : 0;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
