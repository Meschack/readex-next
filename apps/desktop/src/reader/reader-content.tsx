import { createMemo, For, onCleanup, Show } from "solid-js";
import { primaryDefinition, type WordInsight } from "@readex/learning";
import { tokenizeReaderText, type ReaderTextToken } from "@readex/text";
import { DictionaryStatus } from "./reader-feedback";
import type { SelectedWord } from "./reader-experience-types";
import type { ReaderParagraphView, ReaderSentenceView } from "./reader-view";

const tokenCache = new WeakMap<ReaderSentenceView, ReaderTextToken[]>();

function tokensForSentence(sentence: ReaderSentenceView): ReaderTextToken[] {
  const existing = tokenCache.get(sentence);
  if (existing != null) return existing;

  const tokens = tokenizeReaderText(sentence.text);
  tokenCache.set(sentence, tokens);
  return tokens;
}

interface ReaderParagraphProps {
  paragraph: ReaderParagraphView;
  visibleStartIndex: number;
  visibleEndIndex: number;
  activeSentenceId: string | null;
  bookmarkedSentenceIds: Set<string>;
  readerSearchHitIds: Set<string>;
  selectedWord: SelectedWord | null;
  activeWordInsight: WordInsight | null;
  onRegisterSentence: (sentenceId: string, element: HTMLElement) => void;
  onUnregisterSentence: (sentenceId: string) => void;
  onSelectSentence: (sentenceIndex: number) => void;
  onSelectWord: (
    sentence: ReaderSentenceView,
    token: Extract<ReaderTextToken, { kind: "word" }>
  ) => void;
  onClearWord: () => void;
  onSaveWord: (insight: WordInsight) => void;
}

export function ReaderParagraph(props: ReaderParagraphProps) {
  const visibleSentences = createMemo(() =>
    props.paragraph.sentences.filter(
      (sentence) =>
        sentence.index >= props.visibleStartIndex && sentence.index < props.visibleEndIndex
    )
  );
  const isSelectedWord = (sentenceId: string, token: ReaderTextToken) =>
    token.kind === "word" &&
    props.selectedWord?.sentenceId === sentenceId &&
    props.selectedWord?.tokenIndex === token.index;

  return (
    <p class="reader-paragraph">
      <For each={visibleSentences()}>
        {(sentence) => {
          onCleanup(() => props.onUnregisterSentence(sentence.id));

          return (
            <span
              ref={(element) => props.onRegisterSentence(sentence.id, element)}
              classList={{
                sentence: true,
                active: props.activeSentenceId === sentence.id,
                bookmarked: props.bookmarkedSentenceIds.has(sentence.id),
                "search-hit": props.readerSearchHitIds.has(sentence.id)
              }}
              onClick={() => props.onSelectSentence(sentence.index)}
            >
              <span class="sentence-line">
                <For each={tokensForSentence(sentence)}>
                  {(token) => (
                    <SentenceToken
                      token={token}
                      sentence={sentence}
                      selected={isSelectedWord(sentence.id, token)}
                      insight={isSelectedWord(sentence.id, token) ? props.activeWordInsight : null}
                      onSelect={props.onSelectWord}
                      onClear={props.onClearWord}
                      onSave={props.onSaveWord}
                    />
                  )}
                </For>
              </span>
            </span>
          );
        }}
      </For>
    </p>
  );
}

interface SentenceTokenProps {
  token: ReaderTextToken;
  sentence: ReaderSentenceView;
  selected: boolean;
  insight: WordInsight | null;
  onSelect: (
    sentence: ReaderSentenceView,
    token: Extract<ReaderTextToken, { kind: "word" }>
  ) => void;
  onClear: () => void;
  onSave: (insight: WordInsight) => void;
}

function SentenceToken(props: SentenceTokenProps) {
  if (props.token.kind === "text") return <>{props.token.text}</>;

  const token = props.token;
  const inspectWord = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelect(props.sentence, token);
  };

  return (
    <span class="word-shell">
      <button
        classList={{
          "word-token": true,
          selected: props.selected
        }}
        type="button"
        aria-label={`Right click to inspect ${token.text}`}
        onContextMenu={inspectWord}
      >
        {token.text}
      </button>
      <Show when={props.selected ? props.insight : null}>
        {(insight) => (
          <WordPopover insight={insight()} onClear={props.onClear} onSave={props.onSave} />
        )}
      </Show>
    </span>
  );
}

interface WordPopoverProps {
  insight: WordInsight;
  onClear: () => void;
  onSave: (insight: WordInsight) => void;
}

function WordPopover(props: WordPopoverProps) {
  const runAction = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };
  const definition = () => primaryDefinition(props.insight.entry);

  return (
    <span
      class="word-popover"
      role="dialog"
      aria-label={`Insight for ${props.insight.surface}`}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <strong>{props.insight.surface}</strong>
      <DictionaryStatus insight={props.insight} compact />
      <Show when={definition()}>{(item) => <span>{item().definition}</span>}</Show>
      <Show when={definition()?.example}>
        {(example) => <span class="popover-example">{example()}</span>}
      </Show>
      <span class="popover-actions">
        <Show when={props.insight.status === "ready" && !props.insight.saved}>
          <button
            class="save-word-button"
            type="button"
            onClick={(event) => runAction(event, () => props.onSave(props.insight))}
          >
            Save
          </button>
        </Show>
        <button
          type="button"
          aria-label="Close word insight"
          onClick={(event) => {
            event.stopPropagation();
            props.onClear();
          }}
        >
          Close
        </button>
      </span>
    </span>
  );
}
