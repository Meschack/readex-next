import { createSentenceId } from "@readex/reader";
import { segmentSentences } from "@readex/text";
import type { ReaderDocumentDto } from "./reader-document";
import { fixtureBook, type FixtureBook } from "./fixture-book";

export interface ReaderSentenceView {
  id: string;
  index: number;
  text: string;
}

export interface ReaderChapterNavigationItem {
  id: string;
  title: string;
  index: number;
  sentenceCount: number;
}

export interface ReaderView {
  source: "sample" | "library";
  book: {
    id: string;
    title: string;
    author: string;
  };
  chapter: {
    id: string;
    title: string;
  };
  chapters: ReaderChapterNavigationItem[];
  initialSentenceIndex: number;
  totalSentenceCount: number;
  sentences: ReaderSentenceView[];
}

export interface BuildReaderViewOptions {
  chapterId?: string;
  sentenceIndex?: number;
}

export function buildFixtureReaderView(
  options: BuildReaderViewOptions = {},
  book: FixtureBook = fixtureBook
): ReaderView {
  const chapters = book.chapters.map((chapter, index) => ({
    id: chapter.id,
    title: chapter.title,
    index,
    sentenceCount: segmentSentences(chapter.body).length
  }));
  const chapter = book.chapters.find((entry) => entry.id === options.chapterId) ?? book.chapters[0];

  if (chapter == null) {
    return {
      source: "sample",
      book: {
        id: book.id,
        title: book.title,
        author: book.author
      },
      chapter: {
        id: "empty",
        title: "Untitled chapter"
      },
      chapters: [],
      initialSentenceIndex: 0,
      totalSentenceCount: 0,
      sentences: []
    };
  }

  const sentences = segmentSentences(chapter.body);

  return {
    source: "sample",
    book: {
      id: book.id,
      title: book.title,
      author: book.author
    },
    chapter: {
      id: chapter.id,
      title: chapter.title
    },
    chapters,
    initialSentenceIndex: resolveInitialSentenceIndex(
      sentences.length,
      options.chapterId === chapter.id ? options.sentenceIndex : undefined
    ),
    totalSentenceCount: totalSentenceCount(chapters),
    sentences: sentences.map((sentence) => ({
      id: createSentenceId(book.id, chapter.id, sentence.index),
      index: sentence.index,
      text: sentence.text
    }))
  };
}

export function buildReaderViewFromDocument(
  document: ReaderDocumentDto,
  options: BuildReaderViewOptions = {}
): ReaderView {
  const chapter =
    document.chapters.find((entry) => entry.id === options.chapterId) ??
    document.chapters.find((entry) => entry.id === document.position?.chapterId) ??
    document.chapters[0];

  if (chapter == null) {
    return {
      source: "library",
      book: document.book,
      chapter: {
        id: "empty",
        title: "Untitled chapter"
      },
      chapters: [],
      initialSentenceIndex: 0,
      totalSentenceCount: 0,
      sentences: []
    };
  }

  return {
    source: "library",
    book: document.book,
    chapter: {
      id: chapter.id,
      title: chapter.title
    },
    chapters: document.chapters.map((entry) => ({
      id: entry.id,
      title: entry.title,
      index: entry.index,
      sentenceCount: entry.sentences.length
    })),
    initialSentenceIndex: resolveInitialSentenceIndex(
      chapter.sentences.length,
      options.chapterId === chapter.id && options.sentenceIndex != null
        ? options.sentenceIndex
        : document.position?.chapterId === chapter.id
          ? document.position.sentenceIndex
          : undefined
    ),
    totalSentenceCount: document.chapters.reduce(
      (total, entry) => total + entry.sentences.length,
      0
    ),
    sentences: chapter.sentences.map((sentence) => ({
      id: sentence.id,
      index: sentence.index,
      text: sentence.text
    }))
  };
}

function totalSentenceCount(chapters: ReaderChapterNavigationItem[]): number {
  return chapters.reduce((total, chapter) => total + chapter.sentenceCount, 0);
}

function resolveInitialSentenceIndex(sentenceCount: number, sentenceIndex?: number): number {
  if (sentenceCount <= 0 || sentenceIndex == null || !Number.isFinite(sentenceIndex)) return 0;
  return Math.max(0, Math.min(Math.trunc(sentenceIndex), sentenceCount - 1));
}
