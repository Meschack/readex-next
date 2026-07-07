import { createSentenceId } from "@readex/reader";
import { segmentSentences, tokenizeReaderText, type ReaderTextToken } from "@readex/text";
import type { ReaderDocumentDto } from "./reader-document";
import { fixtureBook, type FixtureBook } from "./fixture-book";

export interface ReaderSentenceView {
  id: string;
  index: number;
  text: string;
  tokens: ReaderTextToken[];
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
  initialSentenceIndex: number;
  sentences: ReaderSentenceView[];
}

export function buildFixtureReaderView(book: FixtureBook = fixtureBook): ReaderView {
  return {
    source: "sample",
    book: {
      id: book.id,
      title: book.title,
      author: book.author
    },
    chapter: {
      id: book.chapter.id,
      title: book.chapter.title
    },
    initialSentenceIndex: 0,
    sentences: segmentSentences(book.chapter.body).map((sentence) => ({
      id: createSentenceId(book.id, book.chapter.id, sentence.index),
      index: sentence.index,
      text: sentence.text,
      tokens: tokenizeReaderText(sentence.text)
    }))
  };
}

export function buildReaderViewFromDocument(document: ReaderDocumentDto): ReaderView {
  const chapter =
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
      initialSentenceIndex: 0,
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
    initialSentenceIndex:
      document.position?.chapterId === chapter.id ? document.position.sentenceIndex : 0,
    sentences: chapter.sentences.map((sentence) => ({
      id: sentence.id,
      index: sentence.index,
      text: sentence.text,
      tokens: tokenizeReaderText(sentence.text)
    }))
  };
}
