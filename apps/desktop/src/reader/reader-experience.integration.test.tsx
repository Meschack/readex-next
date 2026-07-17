// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { DEFAULT_AUDIO_SETTINGS, SUPPORTED_NARRATION_VOICES } from "@sonelle/audio";
import { createDomainEvent, createDomainEventDispatcher } from "@sonelle/domain";
import { createSavedDictionary } from "@sonelle/learning";
import { createReaderPreferences, type ReaderPreferences } from "@sonelle/reader";
import type { ReaderExperienceDependencies } from "./reader-dependencies";
import { ReaderExperience } from "./reader-experience";
import type { ReaderNarrationWorkflow } from "./reader-narration-workflow";
import { buildFixtureReaderView } from "./reader-view";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("ReaderExperience integration", () => {
  it("starts the application workflows, reacts to reader closure, and disposes them", async () => {
    const dispatcher = createDomainEventDispatcher();
    const reader = buildFixtureReaderView();
    const pause = vi.fn().mockResolvedValue(undefined);
    const stopNarration = vi.fn();
    const stopDrops = vi.fn();
    const stopVoiceEvents = vi.fn();
    const dependencies = createDependencies({
      dispatcher,
      pause,
      stopNarration,
      stopDrops,
      stopVoiceEvents
    });
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => <ReaderExperience dependencies={dependencies} />, container);

    expect(container.querySelector(".reader-surface")).not.toBeNull();
    await dispatcher.dispatch(
      createDomainEvent("ReaderClosed", {
        bookId: reader.book.id,
        chapterId: reader.chapter.id,
        sentenceId: reader.sentences[0]?.id ?? ""
      })
    );

    expect(container.querySelector(".library-workspace")).not.toBeNull();
    expect(pause).toHaveBeenCalledOnce();
    dispose();
    await vi.waitFor(() => {
      expect(stopNarration).toHaveBeenCalledOnce();
      expect(stopDrops).toHaveBeenCalledOnce();
      expect(stopVoiceEvents).toHaveBeenCalledOnce();
    });
    container.remove();
  });

  it("loads installed fonts and applies persisted book and interface selections", async () => {
    const savePreferences = vi.fn();
    const dependencies = createDependencies({
      dispatcher: createDomainEventDispatcher(),
      pause: vi.fn().mockResolvedValue(undefined),
      stopNarration: vi.fn(),
      stopDrops: vi.fn(),
      stopVoiceEvents: vi.fn(),
      savePreferences
    });
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => <ReaderExperience dependencies={dependencies} />, container);

    const settingsTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent?.includes("Tools")
    );
    expect(settingsTab).not.toBeUndefined();
    settingsTab?.click();

    const bookFontTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Book content font"]'
    );
    await vi.waitFor(() => expect(bookFontTrigger).not.toBeNull());
    bookFontTrigger?.click();
    await vi.waitFor(() =>
      expect(
        [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].some((option) =>
          option.textContent?.includes("Literata")
        )
      ).toBe(true)
    );
    const literata = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.textContent?.includes("Literata")
    );
    literata?.click();

    const interfaceFontTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="App interface font"]'
    );
    interfaceFontTrigger?.click();
    const inter = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.textContent?.includes("Inter")
    );
    inter?.click();

    const shell = container.querySelector<HTMLElement>(".sonelle-shell");
    await vi.waitFor(() => {
      expect(shell?.style.getPropertyValue("--reader-font")).toContain('"Literata"');
      expect(shell?.style.getPropertyValue("--ui-font")).toContain('"Inter"');
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ contentFontFamily: "Literata", uiFontFamily: "Inter" })
      );
    });

    dispose();
    container.remove();
  });

  it("loads and persists configurable narration and bookmark colors", async () => {
    const savePreferences = vi.fn();
    const dependencies = createDependencies({
      dispatcher: createDomainEventDispatcher(),
      pause: vi.fn().mockResolvedValue(undefined),
      stopNarration: vi.fn(),
      stopDrops: vi.fn(),
      stopVoiceEvents: vi.fn(),
      savePreferences,
      readerPreferences: createReaderPreferences({
        narrationHighlightColor: "#abcdef",
        bookmarkHighlightColor: "#123456"
      })
    });
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => <ReaderExperience dependencies={dependencies} />, container);
    const shell = container.querySelector<HTMLElement>(".sonelle-shell");

    expect(shell?.style.getPropertyValue("--narration-highlight")).toBe("#abcdef");
    expect(shell?.style.getPropertyValue("--narration-highlight-ink")).toBe("#242625");
    expect(shell?.style.getPropertyValue("--bookmark-highlight")).toBe("#123456");
    expect(shell?.style.getPropertyValue("--bookmark-highlight-ink")).toBe("#ffffff");

    savePreferences.mockClear();
    clickInspectorTab(container, "Tools");
    const narrationColor = container.querySelector<HTMLInputElement>(
      '[aria-label="Narration highlight color"]'
    );
    const bookmarkColor = container.querySelector<HTMLInputElement>(
      '[aria-label="Bookmark highlight color"]'
    );
    expect(narrationColor).not.toBeNull();
    expect(bookmarkColor).not.toBeNull();

    if (narrationColor != null) {
      narrationColor.value = "#102030";
      narrationColor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (bookmarkColor != null) {
      bookmarkColor.value = "#ddeeff";
      bookmarkColor.dispatchEvent(new Event("input", { bubbles: true }));
    }

    await vi.waitFor(() => {
      expect(shell?.style.getPropertyValue("--narration-highlight")).toBe("#102030");
      expect(shell?.style.getPropertyValue("--bookmark-highlight")).toBe("#ddeeff");
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          narrationHighlightColor: "#102030",
          bookmarkHighlightColor: "#ddeeff"
        })
      );
    });
    expect(shell?.style.getPropertyValue("--narration-highlight-ink")).toBe("#ffffff");
    expect(shell?.style.getPropertyValue("--bookmark-highlight-ink")).toBe("#242625");

    dispose();
    container.remove();
  });

  it("restores and persists resized reader rails", async () => {
    let persistedPreferences = createReaderPreferences({
      libraryRailWidth: 360,
      inspectorRailWidth: 420
    });
    const savePreferences = vi.fn((preferences: ReaderPreferences) => {
      persistedPreferences = preferences;
    });
    const dependenciesForPreferences = () =>
      createDependencies({
        dispatcher: createDomainEventDispatcher(),
        pause: vi.fn().mockResolvedValue(undefined),
        stopNarration: vi.fn(),
        stopDrops: vi.fn(),
        stopVoiceEvents: vi.fn(),
        savePreferences,
        readerPreferences: persistedPreferences
      });
    const previousViewportWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_600 });
    const firstContainer = document.createElement("div");
    document.body.append(firstContainer);
    const disposeFirst = render(
      () => <ReaderExperience dependencies={dependenciesForPreferences()} />,
      firstContainer
    );
    const firstShell = firstContainer.querySelector<HTMLElement>(".sonelle-shell");

    expect(firstShell?.style.getPropertyValue("--library-rail-width")).toBe("360px");
    expect(firstShell?.style.getPropertyValue("--inspector-rail-width")).toBe("420px");

    firstContainer
      .querySelector<HTMLElement>('[aria-label="Resize library sidebar"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    await vi.waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ libraryRailWidth: 376, inspectorRailWidth: 420 })
      )
    );
    disposeFirst();
    firstContainer.remove();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const secondContainer = document.createElement("div");
    document.body.append(secondContainer);
    const disposeSecond = render(
      () => <ReaderExperience dependencies={dependenciesForPreferences()} />,
      secondContainer
    );
    const secondShell = secondContainer.querySelector<HTMLElement>(".sonelle-shell");

    expect(secondShell?.style.getPropertyValue("--library-rail-width")).toBe("220px");
    expect(secondShell?.style.getPropertyValue("--inspector-rail-width")).toBe("280px");
    expect(persistedPreferences).toEqual(
      expect.objectContaining({ libraryRailWidth: 376, inspectorRailWidth: 420 })
    );

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_600 });
    window.dispatchEvent(new Event("resize"));
    expect(secondShell?.style.getPropertyValue("--library-rail-width")).toBe("376px");
    expect(secondShell?.style.getPropertyValue("--inspector-rail-width")).toBe("420px");

    disposeSecond();
    secondContainer.remove();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousViewportWidth
    });
  });

  it("keeps every inspector mode available through the reader shell", async () => {
    const dependencies = createDependencies({
      dispatcher: createDomainEventDispatcher(),
      pause: vi.fn().mockResolvedValue(undefined),
      stopNarration: vi.fn(),
      stopDrops: vi.fn(),
      stopVoiceEvents: vi.fn()
    });
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => <ReaderExperience dependencies={dependencies} />, container);

    expect(container.textContent).toContain("No word selected");

    clickInspectorTab(container, "Search");
    expect(container.querySelector('[aria-label="Search this chapter"]')).not.toBeNull();

    clickInspectorTab(container, "Notes");
    expect(container.textContent).toContain("Saved Passages");

    clickInspectorTab(container, "Tools");
    expect(container.querySelector('[aria-label="Narration speed"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Book content font"]')).not.toBeNull();
    expect(container.textContent).toContain("Prepared audio for this book");
    expect(container.textContent).not.toContain("Diagnostics");

    dispose();
    container.remove();
  });

  it("refreshes prepared audio for the active book", async () => {
    const getAudioCacheStats = vi
      .fn<(bookId: string) => Promise<{ sentenceCount: number; sizeBytes: number }>>()
      .mockResolvedValue({ sentenceCount: 8, sizeBytes: 6_800_000 });
    const dependencies = createDependencies({
      dispatcher: createDomainEventDispatcher(),
      pause: vi.fn().mockResolvedValue(undefined),
      stopNarration: vi.fn(),
      stopDrops: vi.fn(),
      stopVoiceEvents: vi.fn(),
      getAudioCacheStats
    });
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => <ReaderExperience dependencies={dependencies} />, container);

    await vi.waitFor(() => expect(getAudioCacheStats).toHaveBeenCalled());
    getAudioCacheStats.mockClear();
    clickInspectorTab(container, "Tools");
    const refresh = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Refresh"
    );
    expect(refresh).not.toBeUndefined();
    refresh?.click();

    await vi.waitFor(() => expect(getAudioCacheStats).toHaveBeenCalledOnce());
    expect(getAudioCacheStats).toHaveBeenCalledWith(buildFixtureReaderView().book.id);
    expect(container.textContent).not.toContain("Narration needs attention");

    dispose();
    container.remove();
  });

  it("exports the active paragraph from beside the local storage status", async () => {
    const exportParagraphImage = vi.fn().mockResolvedValue("sonelle-passage.png");
    const dependencies = createDependencies({
      dispatcher: createDomainEventDispatcher(),
      pause: vi.fn().mockResolvedValue(undefined),
      stopNarration: vi.fn(),
      stopDrops: vi.fn(),
      stopVoiceEvents: vi.fn(),
      exportParagraphImage
    });
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => <ReaderExperience dependencies={dependencies} />, container);

    const action = container.querySelector<HTMLButtonElement>(
      '.product-status-actions [aria-label="Save paragraph as image"]'
    );
    expect(action).not.toBeNull();
    action?.click();

    await vi.waitFor(() => expect(exportParagraphImage).toHaveBeenCalledOnce());
    expect(exportParagraphImage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookTitle: "The Listening Margin",
        chapterTitle: "Chapter 1"
      })
    );
    await vi.waitFor(() => expect(container.textContent).toContain("Paragraph image ready"));

    dispose();
    container.remove();
  });

  it("blocks playback until the routed narration engine is ready", async () => {
    const requestPlayback = vi.fn();
    const dependencies = createDependencies({
      dispatcher: createDomainEventDispatcher(),
      pause: vi.fn().mockResolvedValue(undefined),
      stopNarration: vi.fn(),
      stopDrops: vi.fn(),
      stopVoiceEvents: vi.fn(),
      requestPlayback,
      engineStatus: "not-installed",
      offlineLibrary: "language-pack"
    });
    const container = document.createElement("div");
    document.body.append(container);
    const dispose = render(() => <ReaderExperience dependencies={dependencies} />, container);

    clickInspectorTab(container, "Tools");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Download narration files to listen offline.")
    );
    container.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click();

    await vi.waitFor(() => {
      expect(requestPlayback).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Download English narration to listen offline.");
    });

    dispose();
    container.remove();
  });
});

function clickInspectorTab(container: HTMLElement, label: string) {
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) =>
    button.textContent?.includes(label)
  );
  expect(tab).not.toBeUndefined();
  tab?.click();
}

interface DependencySpies {
  dispatcher: ReturnType<typeof createDomainEventDispatcher>;
  pause(): Promise<void>;
  stopNarration(): void;
  stopDrops(): void;
  stopVoiceEvents(): void;
  savePreferences?: (preferences: ReaderPreferences) => void;
  requestPlayback?: (sentenceId: string) => void;
  engineStatus?: "ready" | "not-installed";
  offlineLibrary?: "individual-voice" | "language-pack";
  readerPreferences?: ReaderPreferences;
  exportParagraphImage?: (content: {
    paragraphText: string;
    bookTitle: string;
    author: string;
    chapterTitle: string;
  }) => Promise<string>;
  getAudioCacheStats?: (bookId: string) => Promise<{ sentenceCount: number; sizeBytes: number }>;
}

function createDependencies(spies: DependencySpies): ReaderExperienceDependencies {
  const voiceId = DEFAULT_AUDIO_SETTINGS.voiceId;
  const readyVoice = {
    voiceId,
    status: "ready" as const,
    downloadSizeBytes: 0,
    downloadedBytes: 0,
    progress: 100,
    message: "Ready"
  };
  const narrationWorkflow = {
    requestPlayback: spies.requestPlayback ?? vi.fn(),
    pause: spies.pause,
    setOutput: vi.fn(),
    prefetchUpcoming: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(() => spies.stopNarration)
  } satisfies ReaderNarrationWorkflow;

  return {
    audioCacheRepository: {
      getStats:
        spies.getAudioCacheStats ?? vi.fn().mockResolvedValue({ sentenceCount: 0, sizeBytes: 0 }),
      clear: vi.fn().mockResolvedValue({ sentenceCount: 0, sizeBytes: 0 })
    },
    audioSettingsRepository: {
      load: () => DEFAULT_AUDIO_SETTINGS,
      save: vi.fn()
    },
    bookCatalog: {
      list: vi.fn().mockResolvedValue([]),
      open: vi.fn().mockRejectedValue(new Error("No library book selected"))
    },
    bookDropAdapter: { listen: vi.fn().mockResolvedValue(spies.stopDrops) },
    bookOpenRequestAdapter: { listen: vi.fn().mockResolvedValue(() => undefined) },
    bookExporter: {
      exportData: vi.fn().mockRejectedValue(new Error("No library book selected"))
    },
    bookImporter: {
      importFromDialog: vi.fn().mockResolvedValue(null),
      importFromPath: vi.fn().mockRejectedValue(new Error("No import requested"))
    },
    bookmarkStore: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockRejectedValue(new Error("No bookmark requested")),
      delete: vi.fn().mockResolvedValue(undefined)
    },
    dictionaryRepository: {
      lookupWord: vi.fn().mockResolvedValue(null),
      loadSavedDictionary: createSavedDictionary,
      saveSavedDictionary: vi.fn()
    },
    engineInstallationRepository: {
      getStatus: vi.fn(async (engineId) => ({
        engineId,
        status: spies.engineStatus ?? "ready",
        modelRevision: `${engineId}-test`,
        downloadSizeBytes: spies.engineStatus === "not-installed" ? 100 : 0,
        downloadedBytes: 0,
        progress: spies.engineStatus === "not-installed" ? null : 100,
        message:
          spies.engineStatus === "not-installed"
            ? "Download narration files to listen offline."
            : "Ready"
      })),
      install: vi.fn(async (engineId) => ({
        engineId,
        status: "ready" as const,
        modelRevision: `${engineId}-test`,
        downloadSizeBytes: 0,
        downloadedBytes: 0,
        progress: 100,
        message: "Ready"
      })),
      listen: vi.fn().mockResolvedValue(() => undefined)
    },
    eventDispatcher: spies.dispatcher,
    fontCatalog: { listFamilies: vi.fn().mockResolvedValue(["Inter", "Literata"]) },
    librarySearch: { search: vi.fn().mockResolvedValue([]) },
    narration: {
      capabilities: {
        offlineLibrary: spies.offlineLibrary ?? "individual-voice",
        preparesAcrossChapters: spies.offlineLibrary === "language-pack"
      },
      activateSettings: (settings) => settings,
      voices: () => SUPPORTED_NARRATION_VOICES,
      observeEngineInstallation: vi.fn(),
      createWorkflow: () => narrationWorkflow
    },
    paragraphImageExporter: {
      export: spies.exportParagraphImage ?? vi.fn().mockResolvedValue("paragraph.png")
    },
    readerPreferencesRepository: {
      load: () => spies.readerPreferences ?? createReaderPreferences(),
      save: spies.savePreferences ?? vi.fn()
    },
    readingPositionStore: { save: vi.fn().mockResolvedValue(undefined) },
    voiceInstallationRepository: {
      getStatus: vi.fn().mockResolvedValue(readyVoice),
      install: vi.fn().mockResolvedValue(readyVoice),
      listen: vi.fn().mockResolvedValue(spies.stopVoiceEvents)
    }
  };
}
