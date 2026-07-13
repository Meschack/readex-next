import type {
  NarrationPreparationAdapter,
  NarrationPreparationRequest,
  PreparedNarration
} from "./narration-contracts";
import { assertPreparedNarration } from "./narration-manifest";

export interface LatestNarrationPreparation {
  prepare(request: NarrationPreparationRequest): Promise<PreparedNarration>;
  cancel(): void;
}

export class StaleNarrationPreparationError extends Error {
  constructor() {
    super("Narration preparation was superseded by a newer request.");
    this.name = "StaleNarrationPreparationError";
  }
}

export function createLatestNarrationPreparation(
  adapter: NarrationPreparationAdapter
): LatestNarrationPreparation {
  let generation = 0;
  let activeController: AbortController | null = null;

  return {
    async prepare(request) {
      const requestGeneration = ++generation;
      activeController?.abort(new StaleNarrationPreparationError());
      const controller = new AbortController();
      activeController = controller;

      try {
        const narration = await adapter.prepare(request, controller.signal);
        if (requestGeneration !== generation || controller.signal.aborted) {
          throw new StaleNarrationPreparationError();
        }
        return assertPreparedNarration(narration, request.passage.sentences);
      } catch (error) {
        if (requestGeneration !== generation || controller.signal.aborted) {
          throw new StaleNarrationPreparationError();
        }
        throw error;
      } finally {
        if (requestGeneration === generation) activeController = null;
      }
    },

    cancel() {
      generation += 1;
      activeController?.abort(new StaleNarrationPreparationError());
      activeController = null;
    }
  };
}
