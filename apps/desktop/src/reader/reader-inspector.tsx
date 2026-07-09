import { For, Show, type JSX } from "solid-js";
import {
  DEFAULT_AUDIO_SETTINGS,
  SUPPORTED_NARRATION_VOICES,
  type AudioSettings
} from "@readex/audio";
import { primaryDefinition, type SavedDictionaryEntry, type WordInsight } from "@readex/learning";
import type { ReaderSearchResult } from "@readex/reader";
import type { AudioCacheStatsDto } from "../audio/audio-cache-repository";
import type { LibraryBookmarkDto } from "../library/book-repository";
import { formatBytes } from "./reader-formatting";
import { DictionaryStatus, StateBlock } from "./reader-feedback";
import type { InspectorTab } from "./reader-experience-types";
import type { ReaderSentenceView } from "./reader-view";
import { BookmarkIcon, HeadphonesIcon, SearchIcon, SettingsIcon, WordIcon } from "./reader-icons";

interface ReaderInspectorProps {
  tab: InspectorTab;
  insight: WordInsight | null;
  savedWords: SavedDictionaryEntry[];
  readerSearchQuery: string;
  readerSearchResults: ReaderSearchResult<ReaderSentenceView>[];
  bookmarks: LibraryBookmarkDto[];
  activeBookmark: LibraryBookmarkDto | null;
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
      <header class="inspector-header">
        <span>Inspector</span>
        <strong>Contextual Tools</strong>
      </header>
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
  notice: string | null;
  onToggleActive: () => void;
  onOpenBookmark: (bookmark: LibraryBookmarkDto) => void;
  onDeleteBookmark: (bookmarkId: string) => void;
}

function BookmarkPanel(props: BookmarkPanelProps) {
  return (
    <section class="inspector-panel bookmark-panel" aria-label="Bookmarks">
      <div class="panel-title-row">
        <strong>Saved Passages ({props.bookmarks.length})</strong>
        <button type="button" onClick={props.onToggleActive}>
          {props.activeBookmark == null ? "Save current" : "Remove current"}
        </button>
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
                <button type="button" onClick={() => props.onOpenBookmark(bookmark)}>
                  <span>Sentence {bookmark.sentenceIndex + 1}</span>
                  <small>{bookmark.text}</small>
                </button>
                <button
                  class="mini-danger"
                  type="button"
                  aria-label="Delete bookmark"
                  onClick={() => props.onDeleteBookmark(bookmark.id)}
                >
                  Delete
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
  const speedOptions = [0.75, 0.9, 1, 1.25, 1.5];
  const voiceDescription = (voiceId: string) => {
    if (voiceId.includes("en_US")) return "Soft, narrative American accent";
    if (voiceId.includes("en_GB")) return "Deep, scholarly British accent";

    return "Standard synthesized voice";
  };

  return (
    <section class="inspector-panel settings-panel" aria-label="Settings">
      <label class="setting-field">
        <span class="inspector-section-title">Narration speed</span>
        <select
          aria-label="Narration speed"
          value={props.audioSettings.playbackRate.toString()}
          onChange={(event) =>
            props.onAudioSettingsChange({ playbackRate: Number(event.currentTarget.value) })
          }
        >
          <For each={speedOptions}>
            {(speed) => (
              <option value={speed.toString()}>{speed.toFixed(speed % 1 === 0 ? 1 : 2)}x</option>
            )}
          </For>
        </select>
      </label>
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
      <span class="inspector-section-title">Voice selection</span>
      <div class="voice-list" role="group" aria-label="Voice selection">
        <For each={SUPPORTED_NARRATION_VOICES}>
          {(voice) => (
            <button
              classList={{ active: props.audioSettings.voiceId === voice.id }}
              type="button"
              onClick={() => props.onAudioSettingsChange({ voiceId: voice.id })}
            >
              <span aria-hidden="true">
                <HeadphonesIcon />
              </span>
              <strong>{voice.label}</strong>
              <small>{voiceDescription(voice.id)}</small>
            </button>
          )}
        </For>
      </div>
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
