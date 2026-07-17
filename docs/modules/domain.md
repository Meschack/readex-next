# Domain

## Owns

- canonical domain-event names and payloads
- event construction, dispatch, and reaction isolation
- shared entity references and language-code normalization

## Refuses To Own

- storage transport, UI projections, Tauri commands, or provider-specific narration behavior
- orchestration of any particular book, reader, or narration workflow

## Interface

`@sonelle/domain` exports `DomainEventPayloadMap`, `createDomainEvent`,
`createDomainEventDispatcher`, shared references, and `normalizeLanguageCode`. The dispatcher invokes
all subscribed reactions and reports their collected failures without allowing one reaction to
suppress the others.

## Domain Events

The payload map is the source of truth. Events coordinate live application reactions and are not
classified by durability because Sonelle does not maintain a domain-event journal.

## Invariants

- names and payloads use product language rather than transport or worker terminology
- event IDs and occurrence times are stable after construction
- one failed listener does not prevent independent listeners from reacting

## Tests

Package tests cover event ordering, failure isolation, idempotent subscriptions, and language
aliases.
