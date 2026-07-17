# 0023: Local Error Diagnostics

## Status

Accepted.

## Context

Sonelle previously printed a limited set of failures to the development terminal. Production builds
discarded the webview reporter entirely, caught event-reaction failures were hidden behind a build
guard, and native failures were spread across ad hoc `eprintln!` calls. A reader could see a humane
error message but had no durable evidence explaining what failed.

## Decision

Sonelle maintains a valid `error.json` document in Tauri's platform-specific application log
directory. The native diagnostics module owns file creation, timestamps, serialization, native
panic capture, and write synchronization. The webview reports structured failures through one
Tauri command and never writes the filesystem directly.

The log is active in development and production. Each entry records the timestamp, source, scope,
message, optional stack and bounded diagnostic details, app version, build kind, platform, and
process ID. The logger deliberately avoids serializing nested application state so book contents do
not accidentally become diagnostics.

The resolved file path is printed to the development terminal during startup. The reader UI does
not expose a diagnostics panel; user-facing notifications remain concise while `error.json` carries
the technical detail.

## Ownership

- `src-tauri/src/error_log.rs` owns the persistent JSON document and native panic reporting.
- `src/platform/error-reporting.ts` owns webview capture, normalization, and the reporting command.

The diagnostics module does not own toast copy, recovery policy, analytics, remote telemetry, or
book data. No diagnostic is uploaded.

## Interface

- `report_app_error(report)` appends a webview error.
- `record_native_error(scope, message)` records native failures and mirrors them to stderr.
- `installAppErrorReporting()` captures `console.error`, uncaught window errors, and unhandled
  promise rejections.
- `observeReaderErrors()` records failure events that application workflows intentionally turn into
  friendly UI state.

## Domain Events

None. Error recording observes failures and must not change application control flow.

## Testing

- Rust tests verify repeated appends remain valid JSON and invalid files recover safely.
- Webview tests verify bounded reports preserve useful primitive context without serializing nested
  reader state.
- Desktop typecheck, webview tests, native tests, and production compilation cover integration.
