import { invoke } from "@tauri-apps/api/core";
import { createMemoryEventJournal, type EventSink } from "@sonelle/storage";

export function createDomainEventSink(): EventSink {
  if (!isTauriRuntime()) return createMemoryEventJournal();

  return {
    append(event) {
      return invoke<void>("record_domain_event", { event });
    }
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
