import { createDomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import {
  createReaderPreferences,
  readerAppearancePreferences,
  type ReaderAppearancePreferences,
  type ReaderPreferences
} from "@sonelle/reader";
import type { ReaderPreferencesRepository } from "./reader-preferences-repository";

interface ReaderAppearanceWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  repository: Pick<ReaderPreferencesRepository, "save">;
  reportEventError(error: unknown): void;
}

interface ReaderAppearanceWorkflowOptions {
  currentPreferences(): ReaderPreferences;
  projectAppearance(preferences: ReaderAppearancePreferences): void;
}

export interface ReaderAppearanceWorkflow {
  change(preferences: Partial<ReaderAppearancePreferences>): void;
  start(): () => void;
}

export function createReaderAppearanceWorkflow(
  dependencies: ReaderAppearanceWorkflowDependencies,
  options: ReaderAppearanceWorkflowOptions
): ReaderAppearanceWorkflow {
  let requestedAppearance = readerAppearancePreferences(options.currentPreferences());

  return {
    change(changes) {
      requestedAppearance = readerAppearancePreferences(
        createReaderPreferences({
          ...options.currentPreferences(),
          ...requestedAppearance,
          ...changes
        })
      );
      void dependencies.eventDispatcher
        .dispatch(createDomainEvent("ReaderAppearanceChanged", requestedAppearance))
        .catch(dependencies.reportEventError);
    },

    start() {
      requestedAppearance = readerAppearancePreferences(options.currentPreferences());
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("ReaderAppearanceChanged", (event) =>
          options.projectAppearance(event.payload)
        ),
        dependencies.eventDispatcher.subscribe("ReaderAppearanceChanged", (event) => {
          dependencies.repository.save(
            createReaderPreferences({ ...options.currentPreferences(), ...event.payload })
          );
        })
      ];

      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  };
}
