import { createDomainEvent, type DomainEventDispatcher } from "@sonelle/domain";
import {
  createReaderPreferences,
  readerTypographyPreferences,
  type ReaderPreferences,
  type ReaderTypographyPreferences
} from "@sonelle/reader";
import type { ReaderPreferencesRepository } from "./reader-preferences-repository";

interface ReaderTypographyWorkflowDependencies {
  eventDispatcher: DomainEventDispatcher;
  repository: Pick<ReaderPreferencesRepository, "save">;
  reportEventError(error: unknown): void;
}

interface ReaderTypographyWorkflowOptions {
  currentPreferences(): ReaderPreferences;
  projectTypography(preferences: ReaderTypographyPreferences): void;
}

export interface ReaderTypographyWorkflow {
  change(preferences: Partial<ReaderTypographyPreferences>): void;
  start(): () => void;
}

export function createReaderTypographyWorkflow(
  dependencies: ReaderTypographyWorkflowDependencies,
  options: ReaderTypographyWorkflowOptions
): ReaderTypographyWorkflow {
  let requestedTypography = readerTypographyPreferences(options.currentPreferences());

  return {
    change(changes) {
      requestedTypography = readerTypographyPreferences(
        createReaderPreferences({
          ...options.currentPreferences(),
          ...requestedTypography,
          ...changes
        })
      );
      void dependencies.eventDispatcher
        .dispatch(createDomainEvent("ReaderTypographyChanged", requestedTypography))
        .catch(dependencies.reportEventError);
    },

    start() {
      requestedTypography = readerTypographyPreferences(options.currentPreferences());
      const subscriptions = [
        dependencies.eventDispatcher.subscribe("ReaderTypographyChanged", (event) =>
          options.projectTypography(event.payload)
        ),
        dependencies.eventDispatcher.subscribe("ReaderTypographyChanged", (event) => {
          dependencies.repository.save(
            createReaderPreferences({ ...options.currentPreferences(), ...event.payload })
          );
        })
      ];

      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  };
}
