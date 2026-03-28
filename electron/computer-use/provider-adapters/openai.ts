import type { ComputerSession } from '../../../shared/computer-use.js';
import { createPlannerState, generateNextActions, reorderChain, type PlannedActions, type ModelChainEntry, type FallbackCallbacks } from './shared.js';

export async function openaiPlanSession(
  session: ComputerSession,
  modelChain: ModelChainEntry[],
  maxRetries: number,
  role: 'driver' | 'recovery' = 'driver',
  captureExcludedApps?: string[],
  callbacks?: FallbackCallbacks,
): Promise<PlannedActions> {
  let effectiveChain = modelChain;
  let plannerState = session.plannerState;
  if (!plannerState) {
    const plannerResult = await createPlannerState(session.goal, modelChain, maxRetries, session.conversationContext, callbacks);
    plannerState = plannerResult.state;
    // If the planner fell back to a different model, reorder the chain so
    // generateNextActions starts with the model that actually worked.
    effectiveChain = reorderChain(modelChain, plannerResult.modelIndex);
  }
  return generateNextActions({
    session: { ...session, plannerState },
    modelChain: effectiveChain,
    maxRetries,
    role,
    captureExcludedApps,
    callbacks,
  });
}
