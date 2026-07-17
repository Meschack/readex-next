import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri-runtime";

const originalConsoleError = console.error.bind(console);
let installed = false;

interface AppErrorReport {
  scope: string;
  message: string;
  stack: string | null;
  details: string | null;
}

export function installAppErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  console.error = (...values: unknown[]) => {
    originalConsoleError(...values);
    const errorIndex = values.findIndex((value) => value instanceof Error);
    const error = errorIndex === -1 ? values[0] : values[errorIndex];
    const details = values.filter((_, index) => index !== (errorIndex === -1 ? 0 : errorIndex));
    void persistReport(createAppErrorReport("console.error", error, details));
  };

  window.addEventListener("error", (event) => {
    void reportAppError("window.error", event.error ?? event.message, [
      event.filename,
      event.lineno,
      event.colno
    ]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    void reportAppError("promise.unhandled", event.reason);
  });
}

export async function reportAppError(scope: string, error: unknown, details: unknown[] = []) {
  const report = createAppErrorReport(scope, error, details);
  originalConsoleError(`[sonelle][${report.scope}] ${report.message}`, error, ...details);
  await persistReport(report);
}

export function createAppErrorReport(
  scope: string,
  error: unknown,
  details: unknown[] = []
): AppErrorReport {
  const normalized = normalizeError(error);
  const formattedDetails = details.map(formatDiagnosticValue).filter(Boolean).join(" | ");
  return {
    scope: sanitize(scope, 120) || "app",
    message: sanitize(normalized.message, 4_000) || "Unknown error",
    stack: normalized.stack == null ? null : sanitize(normalized.stack, 16_000) || null,
    details: formattedDetails.length === 0 ? null : sanitize(formattedDetails, 8_000)
  };
}

function persistReport(report: AppErrorReport): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  return invoke<void>("report_app_error", { report }).catch((error) => {
    originalConsoleError("[sonelle][diagnostics] Could not write error.json.", error);
  });
}

function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null };
  }
  if (typeof error === "string") return { message: error, stack: null };
  return { message: formatDiagnosticValue(error) || "Unknown error", stack: null };
}

function formatDiagnosticValue(value: unknown): string {
  if (value == null) return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (["string", "number", "boolean", "bigint"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return `[${value.slice(0, 12).map(formatDiagnosticValue).join(", ")}]`;
  if (typeof value !== "object") return typeof value;

  const fields = Object.entries(value)
    .slice(0, 20)
    .map(([key, field]) => {
      if (field == null || ["string", "number", "boolean", "bigint"].includes(typeof field)) {
        return `${key}=${String(field)}`;
      }
      if (field instanceof Error) return `${key}=${field.name}: ${field.message}`;
      return `${key}=[${Array.isArray(field) ? "array" : "object"}]`;
    });
  return `{${fields.join(", ")}}`;
}

function sanitize(value: string, maxChars: number): string {
  return Array.from(value)
    .map((character) =>
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(character) ? " " : character
    )
    .slice(0, maxChars)
    .join("")
    .trim();
}
