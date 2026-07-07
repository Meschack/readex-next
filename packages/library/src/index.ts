import type { BookRef } from "@readex/domain";

export interface LibraryBook extends BookRef {
  lastOpenedAt: string | null;
  readyToRead: boolean;
}
