import type { BookExportDataDto, LibraryBookmarkDto } from "../library/book-repository";
import type { ReaderView } from "./reader-view";

export function createSampleExport(
  currentReader: ReaderView,
  activeSentenceIndex: number,
  currentBookmarks: LibraryBookmarkDto[]
): BookExportDataDto {
  return {
    exportedAt: new Date().toISOString(),
    book: currentReader.book,
    chapters: [
      {
        id: currentReader.chapter.id,
        title: currentReader.chapter.title,
        index: 0,
        sentenceCount: currentReader.sentences.length,
        sentences: currentReader.sentences.map((sentence) => ({
          id: sentence.id,
          index: sentence.index,
          text: sentence.text
        }))
      }
    ],
    position: {
      bookId: currentReader.book.id,
      chapterId: currentReader.chapter.id,
      sentenceIndex: activeSentenceIndex,
      updatedAt: new Date().toISOString()
    },
    bookmarks: currentBookmarks
  };
}

export function downloadJson(fileName: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
