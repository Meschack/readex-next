# 0014: Domain Events Drive Follow-up Reactions

## Status

Accepted

## Context

Sonelle already recorded named domain events, but producers still performed their own follow-up
chains. Importing a book, for example, also opened it, refreshed the shelf, refreshed bookmarks,
and selected UI state in the same workflow. Those reactions accumulated in the producer and made
new behavior require editing established behavior.

Event persistence alone is an audit journal. It does not provide event-driven orchestration.

## Decision

Application producers complete one core operation and dispatch the resulting typed domain event.
Independent listeners own follow-up reactions.

The in-process `DomainEventDispatcher`:

- uses the payload map from `@sonelle/domain`
- invokes listeners in registration order
- continues invoking sibling listeners after a failure
- reports all listener failures after dispatch completes
- returns unsubscribe functions for lifecycle cleanup

Renderer-only events use an `EventSink` listener to persist their history in SQLite. Native library
mutations continue writing their durable event in the same transaction as the mutation; their
renderer dispatch is used for reactions and is not persisted a second time.

## Consequences

- Import, bookmark, and export producers no longer know which projections, views, notices, or tools
  react.
- Closing the reader independently navigates to the Library and stops active narration.
- New reactions can be registered without editing the producer.
- Listener ordering is explicit and testable. A failed listener does not prevent unrelated
  reactions from running.
- In-process dispatch is not a durable background queue. Work that must survive application exit
  still requires a transactional outbox and replay cursor; that is intentionally outside this
  decision.
