export interface LibraryBookSummary {
  id: string;
  title: string;
  author: string;
  coverImageSrc?: string | null;
  importedAt: string;
  chapterCount: number;
  sentenceCount: number;
  lastChapterId: string | null;
  completedSentenceCount: number;
}

export interface ReaderDocumentDto {
  book: {
    id: string;
    title: string;
    author: string;
    language?: string | null;
    coverImageSrc?: string | null;
  };
  activeChapterId: string | null;
  chapters: ReaderChapterDto[];
  position: ReadingPositionDto | null;
}

export interface ReaderChapterDto {
  id: string;
  title: string;
  index: number;
  sentenceCount: number;
  sentences: ReaderSentenceDto[];
  paragraphs?: ReaderParagraphDto[];
}

export interface ReaderParagraphDto {
  id: string;
  index: number;
  startSentenceIndex: number;
  sentenceCount: number;
}

export interface ReaderSentenceDto {
  id: string;
  index: number;
  text: string;
}

export interface ReadingPositionDto {
  bookId: string;
  chapterId: string;
  sentenceIndex: number;
  updatedAt: string;
}
