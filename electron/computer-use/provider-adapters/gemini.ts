import type { ComputerSession } from '../../../shared/computer-use.js';
import type { PlannedActions, ModelChainEntry, FallbackCallbacks } from './shared.js';

export async function geminiPlanSession(
  _session: ComputerSession,
  _modelChain: ModelChainEntry[],
  _maxRetries?: number,
  _callbacks?: FallbackCallbacks,
): Promise<PlannedActions> {
  throw new Error('Gemini computer use is not available in the current runtime yet. Add Google model runtime support first.');
}
