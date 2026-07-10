import type { DomainEvent } from "@sonelle/domain";
import {
  dictionaryLookupFailed,
  dictionaryLookupNotFound,
  dictionaryLookupReady,
  type DictionaryLookupResult
} from "@sonelle/learning";
import type { DictionaryRepository } from "../learning/dictionary-repository";

export interface ReaderWordLookupDependencies {
  dictionaryRepository: Pick<DictionaryRepository, "lookupWord">;
}

export async function lookupReaderWord(
  event: DomainEvent<"WordInspected">,
  dependencies: ReaderWordLookupDependencies
): Promise<DictionaryLookupResult> {
  try {
    const entry = await dependencies.dictionaryRepository.lookupWord(
      event.payload.surface,
      event.payload.language
    );
    return entry == null
      ? dictionaryLookupNotFound(event.payload.surface)
      : dictionaryLookupReady(entry);
  } catch {
    return dictionaryLookupFailed();
  }
}
