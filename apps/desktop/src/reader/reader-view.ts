import { createSentenceId } from "@readex/reader";
import { segmentParagraphs, segmentSentences } from "@readex/text";
import type { ReaderDocumentDto, ReaderSentenceDto } from "./reader-document";
import { fixtureBook, type FixtureBook } from "./fixture-book";

export interface ReaderSentenceView {
  id: string;
  index: number;
  text: string;
}

export interface ReaderParagraphView {
  id: string;
  index: number;
  sentences: ReaderSentenceView[];
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
    coverImageSrc: string | null;
  };
  chapter: {
    id: string;
    title: string;
  };
  chapters: ReaderChapterNavigationItem[];
  initialSentenceIndex: number;
  totalSentenceCount: number;
  sentences: ReaderSentenceView[];
  paragraphs: ReaderParagraphView[];
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
        author: book.author,
        coverImageSrc: null
      },
      chapter: {
        id: "empty",
        title: "Untitled chapter"
      },
      chapters: [],
      initialSentenceIndex: 0,
      totalSentenceCount: 0,
      sentences: [],
      paragraphs: []
    };
  }

  const sentences = segmentSentences(chapter.body);
  const sentenceViews = sentences.map((sentence) => ({
    id: createSentenceId(book.id, chapter.id, sentence.index),
    index: sentence.index,
    text: sentence.text
  }));

  return {
    source: "sample",
    book: {
      id: book.id,
      title: book.title,
      author: book.author,
      coverImageSrc: null
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
    sentences: sentenceViews,
    paragraphs: buildParagraphsFromBody(book.id, chapter.id, chapter.body, sentenceViews)
  };
}

export function buildReaderViewFromDocument(
  document: ReaderDocumentDto,
  options: BuildReaderViewOptions = {}
): ReaderView {
  const targetChapterId =
    options.chapterId ?? document.activeChapterId ?? document.position?.chapterId;
  const chapter =
    document.chapters.find((entry) => entry.id === targetChapterId) ??
    document.chapters.find((entry) => entry.id === document.activeChapterId) ??
    document.chapters[0];

  if (chapter == null) {
    return {
      source: "library",
      book: {
        ...document.book,
        coverImageSrc: document.book.coverImageSrc ?? null
      },
      chapter: {
        id: "empty",
        title: "Untitled chapter"
      },
      chapters: [],
      initialSentenceIndex: 0,
      totalSentenceCount: 0,
      sentences: [],
      paragraphs: []
    };
  }

  const sentenceViews = chapter.sentences.map((sentence) => ({
    id: sentence.id,
    index: sentence.index,
    text: sentence.text
  }));

  return {
    source: "library",
    book: {
      ...document.book,
      coverImageSrc: document.book.coverImageSrc ?? null
    },
    chapter: {
      id: chapter.id,
      title: chapter.title
    },
    chapters: document.chapters.map((entry) => ({
      id: entry.id,
      title: entry.title,
      index: entry.index,
      sentenceCount: entry.sentenceCount
    })),
    initialSentenceIndex: resolveInitialSentenceIndex(
      chapter.sentences.length,
      options.chapterId === chapter.id && options.sentenceIndex != null
        ? options.sentenceIndex
        : document.position?.chapterId === chapter.id
          ? document.position.sentenceIndex
          : undefined
    ),
    totalSentenceCount: document.chapters.reduce((total, entry) => total + entry.sentenceCount, 0),
    sentences: sentenceViews,
    paragraphs: buildParagraphsFromDocument(chapter.paragraphs, sentenceViews)
  };
}

function totalSentenceCount(chapters: ReaderChapterNavigationItem[]): number {
  return chapters.reduce((total, chapter) => total + chapter.sentenceCount, 0);
}

function resolveInitialSentenceIndex(sentenceCount: number, sentenceIndex?: number): number {
  if (sentenceCount <= 0 || sentenceIndex == null || !Number.isFinite(sentenceIndex)) return 0;
  return Math.max(0, Math.min(Math.trunc(sentenceIndex), sentenceCount - 1));
}

function buildParagraphsFromBody(
  bookId: string,
  chapterId: string,
  body: string,
  sentences: ReaderSentenceView[]
): ReaderParagraphView[] {
  const paragraphs = segmentParagraphs(body).map((paragraph) => ({
    id: `${bookId}:${chapterId}:paragraph-${paragraph.index + 1}`,
    index: paragraph.index,
    sentences: paragraph.sentences
      .map((sentence) => sentences[sentence.index])
      .filter((sentence): sentence is ReaderSentenceView => sentence != null)
  }));

  return paragraphs.length > 0 ? paragraphs : chunkSentencesIntoParagraphs(sentences);
}

function buildParagraphsFromDocument(
  paragraphs: ReaderDocumentDto["chapters"][number]["paragraphs"],
  sentences: ReaderSentenceView[]
): ReaderParagraphView[] {
  if (paragraphs != null && paragraphs.length > 0) {
    const sentenceById = new Map(sentences.map((sentence) => [sentence.id, sentence]));
    const mappedParagraphs = paragraphs
      .map((paragraph) => ({
        id: paragraph.id,
        index: paragraph.index,
        sentences: paragraph.sentences
          .map(
            (sentence) => sentenceById.get(sentence.id) ?? findSentenceByIndex(sentences, sentence)
          )
          .filter((sentence): sentence is ReaderSentenceView => sentence != null)
      }))
      .filter((paragraph) => paragraph.sentences.length > 0);

    if (mappedParagraphs.length > 0) return mappedParagraphs;
  }

  return chunkSentencesIntoParagraphs(sentences);
}

function findSentenceByIndex(
  sentences: ReaderSentenceView[],
  sentence: ReaderSentenceDto
): ReaderSentenceView | undefined {
  return sentences.find((entry) => entry.index === sentence.index && entry.text === sentence.text);
}

function chunkSentencesIntoParagraphs(sentences: ReaderSentenceView[]): ReaderParagraphView[] {
  const chunkSize = 4;
  const paragraphs: ReaderParagraphView[] = [];

  for (let index = 0; index < sentences.length; index += chunkSize) {
    paragraphs.push({
      id: `fallback-paragraph-${index / chunkSize + 1}`,
      index: index / chunkSize,
      sentences: sentences.slice(index, index + chunkSize)
    });
  }

  return paragraphs;
}
