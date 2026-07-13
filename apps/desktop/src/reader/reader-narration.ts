import {
  createNarrationChapterOutline,
  type NarrationChapterOutline,
  type SentenceNarrationRequest
} from "@sonelle/audio";
import type { ReaderSentenceView, ReaderView } from "./reader-view";

export function createSentenceNarrationRequest(
  currentReader: ReaderView,
  sentence: ReaderSentenceView,
  voiceId: string
): SentenceNarrationRequest {
  return {
    bookId: currentReader.book.id,
    chapterId: currentReader.chapter.id,
    sentenceId: sentence.id,
    sentenceIndex: sentence.index,
    voiceId,
    text: sentence.text
  };
}

export function createReaderNarrationOutline(currentReader: ReaderView): NarrationChapterOutline {
  return createNarrationChapterOutline({
    bookId: currentReader.book.id,
    chapterId: currentReader.chapter.id,
    language: currentReader.book.language,
    sentences: currentReader.sentences.map(({ id, index, text }) => ({ id, index, text })),
    paragraphs: currentReader.paragraphs.map(
      ({ id, index, startSentenceIndex, endSentenceIndex }) => ({
        id,
        index,
        startSentenceIndex,
        endSentenceIndex
      })
    )
  });
}
