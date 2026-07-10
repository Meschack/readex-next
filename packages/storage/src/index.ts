import type { AnyDomainEvent, DomainEvent, DomainEventName } from "@sonelle/domain";

export interface EventSink {
  append<TName extends DomainEventName>(event: DomainEvent<TName>): Promise<void>;
}

export interface EventJournal extends EventSink {
  readAll(): Promise<readonly AnyDomainEvent[]>;
}

export function createMemoryEventJournal(
  initialEvents: readonly AnyDomainEvent[] = []
): EventJournal {
  const events = [...initialEvents];

  return {
    async append(event) {
      events.push(event as AnyDomainEvent);
    },
    async readAll() {
      return [...events];
    }
  };
}
