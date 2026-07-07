import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryBookSummary, ReaderDocumentDto } from "../reader/reader-document";

export interface BookRepository {
  importBookFromDialog(): Promise<ReaderDocumentDto | null>;
  listBooks(): Promise<LibraryBookSummary[]>;
  openBook(bookId: string): Promise<ReaderDocumentDto>;
  saveReadingPosition(input: SaveReadingPositionInput): Promise<void>;
}

export interface SaveReadingPositionInput {
  bookId: string;
  chapterId: string;
  sentenceIndex: number;
}

export function createBookRepository(): BookRepository {
  return isTauriRuntime() ? nativeBookRepository : browserBookRepository;
}

const nativeBookRepository: BookRepository = {
  async importBookFromDialog() {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "EPUB books",
          extensions: ["epub"]
        }
      ]
    });

    if (selected == null || Array.isArray(selected)) return null;

    return invoke<ReaderDocumentDto>("import_epub", { path: selected });
  },

  listBooks() {
    return invoke<LibraryBookSummary[]>("list_books");
  },

  openBook(bookId) {
    return invoke<ReaderDocumentDto>("open_book", { bookId });
  },

  saveReadingPosition(position) {
    return invoke<void>("save_reading_position", { position });
  }
};

const browserBookRepository: BookRepository = {
  async importBookFromDialog() {
    throw new Error("EPUB import is available in the desktop app.");
  },

  async listBooks() {
    return [];
  },

  async openBook() {
    throw new Error("That book is not available in this preview.");
  },

  async saveReadingPosition() {
    return undefined;
  }
};

export function toFriendlyLibraryError(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) return error;
  if (error instanceof Error && error.message.trim().length > 0) return error.message;

  return "Something got in the way. Please try again.";
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
