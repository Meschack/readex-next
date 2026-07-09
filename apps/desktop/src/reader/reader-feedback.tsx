import { Show } from "solid-js";
import type { WordInsight } from "@readex/learning";

interface StateBlockProps {
  title: string;
  body: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}

export function StateBlock(props: StateBlockProps) {
  return (
    <div class="state-block">
      <strong>{props.title}</strong>
      <p>{props.body}</p>
      <Show when={props.actionLabel != null && props.onAction != null}>
        <button type="button" disabled={props.actionDisabled} onClick={() => props.onAction?.()}>
          {props.actionLabel}
        </button>
      </Show>
    </div>
  );
}

interface StateNoticeProps {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}

export function StateNotice(props: StateNoticeProps) {
  const retryable = () => isRecoverableNotice(props.message);

  return (
    <div
      classList={{
        "state-notice": true,
        compact: props.compact === true,
        attention: retryable()
      }}
    >
      <p>{props.message}</p>
      <Show when={retryable()}>
        <button type="button" onClick={props.onRetry}>
          Retry
        </button>
      </Show>
    </div>
  );
}

function isRecoverableNotice(message: string): boolean {
  return message.startsWith("We couldn't") || message.includes("Please try again");
}

interface DictionaryStatusProps {
  insight: WordInsight;
  compact?: boolean;
}

export function DictionaryStatus(props: DictionaryStatusProps) {
  const label = () => {
    if (props.insight.saved) return "Saved";

    switch (props.insight.status) {
      case "loading":
        return "Looking up";
      case "ready":
        return "Definition found";
      case "not-found":
        return "Not found";
      case "error":
        return "Needs attention";
      default:
        return "Ready";
    }
  };

  return (
    <span
      classList={{
        "dictionary-state": true,
        compact: props.compact === true,
        attention: props.insight.status === "error" || props.insight.status === "not-found",
        saved: props.insight.saved
      }}
    >
      {label()}
    </span>
  );
}
