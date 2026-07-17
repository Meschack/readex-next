# 0026: Domain Events Are Not Persisted

## Status

Accepted.

## Context

Sonelle's domain dispatcher coordinates independent reactions inside the running application. A
separate renderer `EventSink` and native event journal also copied those events into a generic
`domain_events` SQLite table. No product workflow replayed that journal, rebuilt projections from
it, exposed it as a user-visible audit history, or used it to recover interrupted work.

The journal therefore added database writes, IPC calls, an allowlist, storage models, and workflow
dependencies without contributing to application behavior. It also blurred the distinction between
event-driven coordination and event sourcing.

## Decision

Domain events remain the canonical mechanism for follow-up reactions. Producers dispatch typed
facts through `DomainEventDispatcher`; registered listeners update UI projections, trigger
application work, report errors, and clean up their subscriptions with the owning lifecycle.

Domain events are not persisted. Durable product state such as books, chapters, reading positions,
bookmarks, preferences, and prepared narration remains in its purpose-built store. Native database
initialization drops the discontinued `domain_events` table from existing libraries.

## Ownership

- `@sonelle/domain` owns event vocabulary, event creation, dispatch ordering, and failure isolation.
- Reader applications own producer and listener lifecycles.
- Native storage owns durable product projections and refuses to own an event journal.

## Consequences

- Event-driven development remains intact; only event-history recording is removed.
- Routine playback and reader activity no longer generate SQLite writes or event-recording IPC.
- Sonelle does not offer event replay or a durable audit log.
- A future durable workflow must justify and design its own outbox, replay, retention, and privacy
  semantics instead of quietly restoring a generic journal.

## Testing

- Workflow tests subscribe to the real dispatcher and assert published facts and independent
  reactions directly.
- Native storage tests verify that existing `domain_events` tables are removed on initialization.
- Full reader integration continues to cover import, navigation, narration, settings, and cleanup
  through in-memory event listeners.
