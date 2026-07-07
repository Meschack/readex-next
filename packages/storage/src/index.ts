import type { DomainEvent, DomainEventName } from "@readex/domain";

export interface EventStore {
  append<TName extends DomainEventName, TPayload>(
    event: DomainEvent<TName, TPayload>
  ): Promise<void>;
}
