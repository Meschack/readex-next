import {
  createContext,
  createEffect,
  createMemo,
  For,
  onCleanup,
  onMount,
  Show,
  useContext,
  type ParentProps
} from "solid-js";
import { Portal } from "solid-js/web";
import { primaryDefinition, type WordInsight } from "@sonelle/learning";
import { tokenizeReaderText, type ReaderTextToken } from "@sonelle/text";
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

export interface ReaderContentInteractions {
  isActiveSentence: (sentenceId: string) => boolean;
  isBookmarkedSentence: (sentenceId: string) => boolean;
  isSearchHit: (sentenceId: string) => boolean;
  selectedWord: () => SelectedWord | null;
  activeWordInsight: () => WordInsight | null;
  registerSentence: (sentenceId: string, element: HTMLElement) => void;
  unregisterSentence: (sentenceId: string) => void;
  selectSentence: (sentenceIndex: number) => void;
  selectWord: (
    sentence: ReaderSentenceView,
    token: Extract<ReaderTextToken, { kind: "word" }>
  ) => void;
  clearWord: () => void;
  saveWord: (insight: WordInsight) => void;
}

const ReaderContentContext = createContext<ReaderContentInteractions>();

export function ReaderContentProvider(
  props: ParentProps<{ interactions: ReaderContentInteractions }>
) {
  return (
    <ReaderContentContext.Provider value={props.interactions}>
      {props.children}
    </ReaderContentContext.Provider>
  );
}

function useReaderContentInteractions(): ReaderContentInteractions {
  const interactions = useContext(ReaderContentContext);
  if (interactions == null) {
    throw new Error("Reader content must be rendered inside ReaderContentProvider.");
  }

  return interactions;
}

interface ReaderParagraphProps {
  paragraph: ReaderParagraphView;
  visibleStartIndex: number;
  visibleEndIndex: number;
}

export function ReaderParagraph(props: ReaderParagraphProps) {
  const interactions = useReaderContentInteractions();
  const visibleSentences = createMemo(() =>
    props.paragraph.sentences.filter(
      (sentence) =>
        sentence.index >= props.visibleStartIndex && sentence.index < props.visibleEndIndex
    )
  );
  const isSelectedWord = (sentenceId: string, token: ReaderTextToken) =>
    token.kind === "word" &&
    interactions.selectedWord()?.sentenceId === sentenceId &&
    interactions.selectedWord()?.tokenIndex === token.index;

  return (
    <p class="reader-paragraph">
      <For each={visibleSentences()}>
        {(sentence) => {
          onCleanup(() => interactions.unregisterSentence(sentence.id));

          return (
            <span
              ref={(element) => interactions.registerSentence(sentence.id, element)}
              classList={{
                sentence: true,
                active: interactions.isActiveSentence(sentence.id),
                bookmarked: interactions.isBookmarkedSentence(sentence.id),
                "search-hit": interactions.isSearchHit(sentence.id)
              }}
              onClick={() => interactions.selectSentence(sentence.index)}
            >
              <span class="sentence-line">
                <For each={tokensForSentence(sentence)}>
                  {(token) => (
                    <SentenceToken
                      token={token}
                      sentence={sentence}
                      selected={isSelectedWord(sentence.id, token)}
                      insight={
                        isSelectedWord(sentence.id, token) ? interactions.activeWordInsight() : null
                      }
                      onSelect={interactions.selectWord}
                      onClear={interactions.clearWord}
                      onSave={interactions.saveWord}
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
  let tokenElement: HTMLSpanElement | undefined;
  const inspectWord = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelect(props.sentence, token);
  };

  return (
    <span
      ref={(element) => {
        tokenElement = element;
      }}
      classList={{
        "word-token": true,
        selected: props.selected
      }}
      role="button"
      tabIndex={0}
      aria-label={`Right click to inspect ${token.text}`}
      onContextMenu={inspectWord}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") inspectWord(event);
      }}
    >
      {token.text}
      <Show when={props.selected ? props.insight : null}>
        {(insight) => (
          <Portal>
            <WordPopover
              anchorElement={tokenElement}
              insight={insight()}
              onClear={props.onClear}
              onSave={props.onSave}
            />
          </Portal>
        )}
      </Show>
    </span>
  );
}

interface WordPopoverProps {
  anchorElement: HTMLSpanElement | undefined;
  insight: WordInsight;
  onClear: () => void;
  onSave: (insight: WordInsight) => void;
}

function WordPopover(props: WordPopoverProps) {
  let popoverElement: HTMLSpanElement | undefined;

  const updatePosition = () => {
    const anchor = props.anchorElement;
    const popover = popoverElement;
    if (anchor == null || popover == null) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const edgePadding = 16;
    const gap = 12;
    const maxLeft = Math.max(edgePadding, window.innerWidth - popoverRect.width - edgePadding);
    const centeredLeft = anchorRect.left + (anchorRect.width - popoverRect.width) / 2;
    const left = Math.min(maxLeft, Math.max(edgePadding, centeredLeft));
    const belowTop = anchorRect.bottom + gap;
    const aboveTop = anchorRect.top - popoverRect.height - gap;
    const top =
      belowTop + popoverRect.height <= window.innerHeight - edgePadding || aboveTop < edgePadding
        ? Math.min(belowTop, window.innerHeight - popoverRect.height - edgePadding)
        : aboveTop;

    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(edgePadding, top)}px`;
  };

  onMount(() => {
    const schedulePositionUpdate = () => queueMicrotask(updatePosition);
    const closeFromOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        popoverElement?.contains(target) ||
        props.anchorElement?.contains(target)
      ) {
        return;
      }

      props.onClear();
    };

    document.addEventListener("pointerdown", closeFromOutsidePointer, true);
    document.addEventListener("scroll", schedulePositionUpdate, true);
    window.addEventListener("resize", schedulePositionUpdate);
    schedulePositionUpdate();
    onCleanup(() => {
      document.removeEventListener("pointerdown", closeFromOutsidePointer, true);
      document.removeEventListener("scroll", schedulePositionUpdate, true);
      window.removeEventListener("resize", schedulePositionUpdate);
    });
  });

  createEffect(() => {
    props.insight.status;
    queueMicrotask(updatePosition);
  });

  const runAction = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };
  const definition = () => primaryDefinition(props.insight.entry);

  return (
    <span
      ref={(element) => {
        popoverElement = element;
      }}
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
