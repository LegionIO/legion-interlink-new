import type { ComputerSession } from '../../../shared/computer-use.js';
import { createPlannerState, generateNextActions, reorderChain, type PlannedActions, type ModelChainEntry, type FallbackCallbacks } from './shared.js';

export async function anthropicPlanSession(
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
