import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import {
  DEFAULT_AUDIO_SETTINGS,
  SUPPORTED_NARRATION_VOICES,
  type AudioSettings
} from "@sonelle/audio";
import { primaryDefinition, type SavedDictionaryEntry, type WordInsight } from "@sonelle/learning";
import type { ReaderSearchResult } from "@sonelle/reader";
import type { AudioCacheStatsDto } from "../audio/audio-cache-repository";
import type { LibraryBookmarkDto } from "../library/book-repository";
import { formatBytes } from "./reader-formatting";
import { DictionaryStatus, StateBlock } from "./reader-feedback";
import type { InspectorTab } from "./reader-experience-types";
import type { ReaderSentenceView } from "./reader-view";
import {
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  HeadphonesIcon,
  SearchIcon,
  SettingsIcon,
  SpeakerIcon,
  TrashIcon,
  WordIcon
} from "./reader-icons";

interface ReaderInspectorProps {
  tab: InspectorTab;
  insight: WordInsight | null;
  savedWords: SavedDictionaryEntry[];
  readerSearchQuery: string;
  readerSearchResults: ReaderSearchResult<ReaderSentenceView>[];
  bookmarks: LibraryBookmarkDto[];
  activeBookmark: LibraryBookmarkDto | null;
  activeSentence: ReaderSentenceView | null;
  bookmarkNotice: string | null;
  audioSettings: AudioSettings;
  readerContentFontSize: number;
  audioCacheStats: AudioCacheStatsDto | null;
  audioCacheNotice: string | null;
  exportNotice: string | null;
  onTabChange: (tab: InspectorTab) => void;
  onSaveWord: (insight: WordInsight) => void;
  onForgetWord: (surface: string) => void;
  onSelectSavedWord: (word: SavedDictionaryEntry) => void;
  onReaderSearchQueryChange: (query: string) => void;
  onReaderSearchResult: (result: ReaderSearchResult<ReaderSentenceView>) => void;
  onReaderSearchInputReady: (input: HTMLInputElement) => void;
  onToggleBookmark: () => void;
  onOpenBookmark: (bookmark: LibraryBookmarkDto) => void;
  onDeleteBookmark: (bookmarkId: string) => void;
  onAudioSettingsChange: (settings: Partial<AudioSettings>) => void;
  onReaderContentFontSizeChange: (fontSize: number) => void;
  onRefreshCache: () => void;
  onClearCache: () => void;
  onExportBook: () => void;
}

export function ReaderInspector(props: ReaderInspectorProps) {
  const tabs: Array<{ id: InspectorTab; label: string; icon: () => JSX.Element }> = [
    { id: "word", label: "Word", icon: WordIcon },
    { id: "search", label: "Search", icon: SearchIcon },
    { id: "bookmarks", label: "Notes", icon: BookmarkIcon },
    { id: "settings", label: "Tools", icon: SettingsIcon }
  ];

  return (
    <aside class="inspector" aria-label="Reader tools">
      <div class="inspector-tabs" role="tablist" aria-label="Reader tool tabs">
        <For each={tabs}>
          {(tab) => {
            const Icon = tab.icon;

            return (
              <button
                classList={{ active: props.tab === tab.id }}
                type="button"
                role="tab"
                aria-selected={props.tab === tab.id}
                onClick={() => props.onTabChange(tab.id)}
              >
                <Icon />
                <span>{tab.label}</span>
              </button>
            );
          }}
        </For>
      </div>

      <div class="inspector-content">
        {props.tab === "word" ? (
          <WordPanel
            insight={props.insight}
            savedWords={props.savedWords}
            onSave={props.onSaveWord}
            onForget={props.onForgetWord}
            onSelectSavedWord={props.onSelectSavedWord}
          />
        ) : props.tab === "search" ? (
          <SearchPanel
            query={props.readerSearchQuery}
            results={props.readerSearchResults}
            onQueryChange={props.onReaderSearchQueryChange}
            onOpenResult={props.onReaderSearchResult}
            onInputReady={props.onReaderSearchInputReady}
          />
        ) : props.tab === "bookmarks" ? (
          <BookmarkPanel
            bookmarks={props.bookmarks}
            activeBookmark={props.activeBookmark}
            activeSentence={props.activeSentence}
            notice={props.bookmarkNotice}
            onToggleActive={props.onToggleBookmark}
            onOpenBookmark={props.onOpenBookmark}
            onDeleteBookmark={props.onDeleteBookmark}
          />
        ) : (
          <SettingsPanel
            audioSettings={props.audioSettings}
            readerContentFontSize={props.readerContentFontSize}
            audioCacheStats={props.audioCacheStats}
            audioCacheNotice={props.audioCacheNotice}
            exportNotice={props.exportNotice}
            onAudioSettingsChange={props.onAudioSettingsChange}
            onReaderContentFontSizeChange={props.onReaderContentFontSizeChange}
            onResetAudioSettings={() => props.onAudioSettingsChange(DEFAULT_AUDIO_SETTINGS)}
            onRefreshCache={props.onRefreshCache}
            onClearCache={props.onClearCache}
            onExportBook={props.onExportBook}
          />
        )}
      </div>
    </aside>
  );
}

interface WordPanelProps {
  insight: WordInsight | null;
  savedWords: SavedDictionaryEntry[];
  onSave: (insight: WordInsight) => void;
  onForget: (surface: string) => void;
  onSelectSavedWord: (word: SavedDictionaryEntry) => void;
}

function WordPanel(props: WordPanelProps) {
  return (
    <Show
      when={props.insight}
      fallback={
        <>
          <StateBlock
            title="No word selected"
            body="Definitions and saved-word actions appear here."
          />
          <SavedWordList words={props.savedWords} onSelect={props.onSelectSavedWord} />
        </>
      }
    >
      {(insight) => (
        <>
          <div class="inspector-heading">
            <strong>{insight().surface}</strong>
            <DictionaryStatus insight={insight()} />
          </div>
          <div class="dictionary-actions">
            <Show when={insight().status === "ready" && !insight().saved}>
              <button type="button" onClick={() => props.onSave(insight())}>
                Save
              </button>
            </Show>
            <Show when={insight().saved}>
              <button type="button" onClick={() => props.onForget(insight().surface)}>
                Forget
              </button>
            </Show>
          </div>
          <dl>
            <Show when={insight().entry?.phonetic}>
              <div>
                <dt>Pronunciation</dt>
                <dd>{insight().entry?.phonetic}</dd>
              </div>
            </Show>
            <Show when={primaryDefinition(insight().entry)}>
              {(definition) => (
                <div>
                  <dt>Definition</dt>
                  <dd>{definition().definition}</dd>
                </div>
              )}
            </Show>
            <Show when={primaryDefinition(insight().entry)?.example}>
              {(example) => (
                <div>
                  <dt>Example</dt>
                  <dd>{example()}</dd>
                </div>
              )}
            </Show>
            <Show when={insight().entry?.meanings[0]?.partOfSpeech}>
              {(partOfSpeech) => (
                <div>
                  <dt>Type</dt>
                  <dd>{partOfSpeech()}</dd>
                </div>
              )}
            </Show>
            <Show when={primaryDefinition(insight().entry)?.synonyms.length}>
              <div>
                <dt>Synonyms</dt>
                <dd>{primaryDefinition(insight().entry)?.synonyms.slice(0, 6).join(", ")}</dd>
              </div>
            </Show>
            <Show when={insight().entry?.sourceUrl}>
              {(sourceUrl) => (
                <div>
                  <dt>Source</dt>
                  <dd>
                    <a href={sourceUrl()} target="_blank" rel="noreferrer">
                      Dictionary
                    </a>
                  </dd>
                </div>
              )}
            </Show>
            <Show when={insight().message != null && insight().entry == null}>
              <div>
                <dt>Status</dt>
                <dd>{insight().message}</dd>
              </div>
            </Show>
          </dl>
        </>
      )}
    </Show>
  );
}

interface SearchPanelProps {
  query: string;
  results: ReaderSearchResult<ReaderSentenceView>[];
  onQueryChange: (query: string) => void;
  onOpenResult: (result: ReaderSearchResult<ReaderSentenceView>) => void;
  onInputReady: (input: HTMLInputElement) => void;
}

function SearchPanel(props: SearchPanelProps) {
  const hasQuery = () => props.query.trim().length > 0;

  return (
    <section class="inspector-panel" aria-label="Search this chapter">
      <input
        ref={props.onInputReady}
        aria-label="Search this chapter"
        type="search"
        value={props.query}
        placeholder="Search chapter"
        onInput={(event) => props.onQueryChange(event.currentTarget.value)}
      />
      <Show
        when={props.results.length > 0}
        fallback={
          <StateBlock
            title={hasQuery() ? "No matches" : "Search this chapter"}
            body={
              hasQuery() ? "Try a different word or phrase." : "Matching sentences appear here."
            }
          />
        }
      >
        <div class="result-list" role="list">
          <For each={props.results}>
            {(result) => (
              <button type="button" onClick={() => props.onOpenResult(result)}>
                <span>Sentence {result.sentence.index + 1}</span>
                <small>{result.excerpt}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

interface BookmarkPanelProps {
  bookmarks: LibraryBookmarkDto[];
  activeBookmark: LibraryBookmarkDto | null;
  activeSentence: ReaderSentenceView | null;
  notice: string | null;
  onToggleActive: () => void;
  onOpenBookmark: (bookmark: LibraryBookmarkDto) => void;
  onDeleteBookmark: (bookmarkId: string) => void;
}

function BookmarkPanel(props: BookmarkPanelProps) {
  return (
    <section class="inspector-panel bookmark-panel" aria-label="Bookmarks">
      <Show when={props.activeSentence}>
        {(sentence) => (
          <section class="current-sentence-card" aria-label="Current sentence">
            <span class="inspector-section-title">Current sentence</span>
            <blockquote>{sentence().text}</blockquote>
            <button
              classList={{ "current-passage-action": true, saved: props.activeBookmark != null }}
              type="button"
              onClick={props.onToggleActive}
            >
              {props.activeBookmark == null ? "Save passage" : "Remove passage"}
            </button>
          </section>
        )}
      </Show>
      <div class="panel-title-row">
        <strong>Saved Passages ({props.bookmarks.length})</strong>
      </div>
      <Show when={props.notice}>{(notice) => <p class="library-notice">{notice()}</p>}</Show>
      <Show
        when={props.bookmarks.length > 0}
        fallback={
          <StateBlock title="No bookmarks in this book" body="Saved sentences appear here." />
        }
      >
        <div class="result-list" role="list">
          <For each={props.bookmarks}>
            {(bookmark) => (
              <div class="bookmark-row">
                <button
                  class="bookmark-card-button"
                  type="button"
                  onClick={() => props.onOpenBookmark(bookmark)}
                >
                  <span>Sentence {bookmark.sentenceIndex + 1}</span>
                  <small>{bookmark.text}</small>
                </button>
                <button
                  class="bookmark-delete-button"
                  type="button"
                  aria-label={`Delete sentence ${bookmark.sentenceIndex + 1} bookmark`}
                  onClick={() => props.onDeleteBookmark(bookmark.id)}
                  title="Delete bookmark"
                >
                  <TrashIcon />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

interface SettingsPanelProps {
  audioSettings: AudioSettings;
  readerContentFontSize: number;
  audioCacheStats: AudioCacheStatsDto | null;
  audioCacheNotice: string | null;
  exportNotice: string | null;
  onAudioSettingsChange: (settings: Partial<AudioSettings>) => void;
  onReaderContentFontSizeChange: (fontSize: number) => void;
  onResetAudioSettings: () => void;
  onRefreshCache: () => void;
  onClearCache: () => void;
  onExportBook: () => void;
}

function SettingsPanel(props: SettingsPanelProps) {
  return (
    <section class="inspector-panel settings-panel" aria-label="Settings">
      <SpeedSelect
        value={props.audioSettings.playbackRate}
        onChange={(playbackRate) => props.onAudioSettingsChange({ playbackRate })}
      />
      <div class="settings-action-row">
        <button class="secondary-tool-button" type="button" onClick={props.onResetAudioSettings}>
          Reset audio settings
        </button>
      </div>
      <div class="setting-field">
        <span class="inspector-section-title">Book text size</span>
        <div class="font-size-control">
          <input
            aria-label="Book text size"
            type="range"
            min="14"
            max="24"
            step="1"
            value={props.readerContentFontSize}
            onInput={(event) =>
              props.onReaderContentFontSizeChange(Number(event.currentTarget.value))
            }
          />
          <output>{props.readerContentFontSize}px</output>
        </div>
      </div>
      <label class="toggle-row settings-toggle">
        <span>
          <strong>Auto-advance</strong>
          <small>Turn pages automatically while narrating</small>
        </span>
        <input
          type="checkbox"
          checked={props.audioSettings.autoAdvance}
          onChange={(event) =>
            props.onAudioSettingsChange({ autoAdvance: event.currentTarget.checked })
          }
        />
      </label>
      <VoiceSelect
        voiceId={props.audioSettings.voiceId}
        onChange={(voiceId) => props.onAudioSettingsChange({ voiceId })}
      />
      <div class="tool-card">
        <span class="inspector-section-title">Prepared audio</span>
        <p>
          {props.audioCacheStats == null
            ? "Checking cache"
            : `${props.audioCacheStats.sentenceCount} sentence${props.audioCacheStats.sentenceCount === 1 ? "" : "s"} · ${formatBytes(props.audioCacheStats.sizeBytes)}`}
        </p>
        <div class="dictionary-actions">
          <button type="button" onClick={props.onRefreshCache}>
            Refresh
          </button>
          <button type="button" onClick={props.onClearCache}>
            Clear
          </button>
        </div>
        <Show when={props.audioCacheNotice}>
          {(notice) => <p class="library-notice">{notice()}</p>}
        </Show>
      </div>
      <div class="tool-card">
        <span class="inspector-section-title">Data management</span>
        <button class="primary-tool-button" type="button" onClick={props.onExportBook}>
          Export book data
        </button>
        <Show when={props.exportNotice}>
          {(notice) => <p class="library-notice">{notice()}</p>}
        </Show>
      </div>
    </section>
  );
}

interface EnhancedSelectOption {
  id: string;
  label: string;
  description: string;
  meta: string;
}

interface EnhancedSelectProps {
  label: string;
  ariaLabel: string;
  value: string;
  options: readonly EnhancedSelectOption[];
  triggerMeta: string;
  icon: () => JSX.Element;
  onChange: (value: string) => void;
}

const narrationSpeedOptions: readonly EnhancedSelectOption[] = [
  {
    id: "0.75",
    label: "0.75x",
    description: "Slow and spacious",
    meta: "Gentle pace"
  },
  {
    id: "0.9",
    label: "0.90x",
    description: "Relaxed and clear",
    meta: "Recommended"
  },
  {
    id: "1",
    label: "1.0x",
    description: "Natural reading pace",
    meta: "Balanced"
  },
  {
    id: "1.25",
    label: "1.25x",
    description: "Brisk but comfortable",
    meta: "Faster pace"
  },
  {
    id: "1.5",
    label: "1.5x",
    description: "Fast review pace",
    meta: "Quick listen"
  }
];

function VoiceSelect(props: { voiceId: string; onChange: (voiceId: string) => void }) {
  const options = () =>
    SUPPORTED_NARRATION_VOICES.map((voice) => ({
      id: voice.id,
      label: voice.label,
      description: voice.description,
      meta: voice.locale
    }));

  return (
    <EnhancedSelect
      label="Voice selection"
      ariaLabel="Narration voice"
      value={props.voiceId}
      options={options()}
      triggerMeta="Local narration"
      icon={HeadphonesIcon}
      onChange={props.onChange}
    />
  );
}

function SpeedSelect(props: { value: number; onChange: (value: number) => void }) {
  return (
    <EnhancedSelect
      label="Narration speed"
      ariaLabel="Narration speed"
      value={props.value.toString()}
      options={narrationSpeedOptions}
      triggerMeta="Playback speed"
      icon={SpeakerIcon}
      onChange={(value) => props.onChange(Number(value))}
    />
  );
}

function EnhancedSelect(props: EnhancedSelectProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let root: HTMLDivElement | undefined;
  const Icon = props.icon;

  const selectId = props.label.toLowerCase().replace(/[^a-z0-9]+/gu, "-");
  const optionsId = `${selectId}-options`;
  const selectedOption = () =>
    props.options.find((option) => option.id === props.value) ?? props.options[0];
  const selectedIndex = () =>
    Math.max(
      0,
      props.options.findIndex((option) => option.id === selectedOption().id)
    );
  const highlightedOption = () => props.options[highlightedIndex()] ?? selectedOption();

  const openMenu = () => {
    setHighlightedIndex(selectedIndex());
    setIsOpen(true);
  };

  const closeMenu = () => setIsOpen(false);

  const moveHighlight = (direction: -1 | 1) => {
    setHighlightedIndex((current) => {
      const next = current + direction;
      if (next < 0) return props.options.length - 1;
      if (next >= props.options.length) return 0;
      return next;
    });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      closeMenu();
      return;
    }

    if (event.key === "Escape") {
      if (!isOpen()) return;
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen()) {
        openMenu();
        return;
      }
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!isOpen()) return;
      event.preventDefault();
      setHighlightedIndex(event.key === "Home" ? 0 : props.options.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen()) {
        openMenu();
        return;
      }
      props.onChange(highlightedOption().id);
      closeMenu();
    }
  };

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (root != null && !root.contains(event.target as Node)) closeMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    onCleanup(() => document.removeEventListener("pointerdown", handlePointerDown));
  });

  return (
    <div class="enhanced-select" ref={(element) => (root = element)}>
      <span class="inspector-section-title">{props.label}</span>
      <button
        class="enhanced-select-trigger"
        type="button"
        aria-controls={optionsId}
        aria-expanded={isOpen()}
        aria-haspopup="listbox"
        aria-label={props.ariaLabel}
        aria-activedescendant={isOpen() ? `${optionsId}-option-${highlightedIndex()}` : undefined}
        onClick={() => (isOpen() ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span class="enhanced-select-icon" aria-hidden="true">
          <Icon />
        </span>
        <span class="enhanced-select-copy">
          <strong>{selectedOption().label}</strong>
          <small>{selectedOption().description}</small>
          <span class="enhanced-select-meta">
            <span class="enhanced-select-badge">{selectedOption().meta}</span>
            <span>{props.triggerMeta}</span>
          </span>
        </span>
        <span class="enhanced-select-chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>
      <Show when={isOpen()}>
        <div
          id={optionsId}
          class="enhanced-select-options"
          role="listbox"
          aria-label={`Available ${props.label.toLowerCase()} options`}
        >
          <For each={props.options}>
            {(option, index) => (
              <button
                id={`${optionsId}-option-${index()}`}
                classList={{
                  "enhanced-select-option": true,
                  active: props.value === option.id,
                  highlighted: highlightedIndex() === index()
                }}
                type="button"
                role="option"
                aria-selected={props.value === option.id}
                onMouseEnter={() => setHighlightedIndex(index())}
                onClick={() => {
                  props.onChange(option.id);
                  closeMenu();
                }}
              >
                <span class="enhanced-select-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span class="enhanced-select-option-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                  <span class="enhanced-select-meta">
                    <span class="enhanced-select-badge">{option.meta}</span>
                  </span>
                </span>
                <Show when={props.value === option.id}>
                  <span class="enhanced-select-check" aria-label="Selected">
                    <CheckIcon />
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

interface SavedWordListProps {
  words: SavedDictionaryEntry[];
  onSelect: (word: SavedDictionaryEntry) => void;
}

function SavedWordList(props: SavedWordListProps) {
  return (
    <Show
      when={props.words.length > 0}
      fallback={<StateBlock title="No saved words" body="Saved definitions appear here." />}
    >
      <section class="saved-word-list" aria-label="Saved words">
        <span class="inspector-section-title">Saved words</span>
        <For each={props.words}>
          {(word) => (
            <button class="saved-word-row" type="button" onClick={() => props.onSelect(word)}>
              <span>{word.surface}</span>
              <small>{primaryDefinition(word)?.definition ?? "Saved definition"}</small>
            </button>
          )}
        </For>
      </section>
    </Show>
  );
}
