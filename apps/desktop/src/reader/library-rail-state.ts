export type LibraryRailMode =
  | {
      name: "navigation";
    }
  | {
      name: "book";
      bookId: string;
    };

export type LibraryRailEvent =
  | {
      type: "reader-opened";
      bookId: string;
    }
  | {
      type: "library-opened";
    };

export function createLibraryRailMode(bookId: string): LibraryRailMode {
  return {
    name: "book",
    bookId
  };
}

export function transitionLibraryRailMode(
  _current: LibraryRailMode,
  event: LibraryRailEvent
): LibraryRailMode {
  switch (event.type) {
    case "reader-opened":
      return {
        name: "book",
        bookId: event.bookId
      };
    case "library-opened":
      return {
        name: "navigation"
      };
  }
}

export function isBookRailMode(
  mode: LibraryRailMode
): mode is Extract<LibraryRailMode, { name: "book" }> {
  return mode.name === "book";
}
