# 0008: EPUB Import Hardening

Status: accepted

## Context

Real EPUBs vary wildly. Some use nested package paths, `.htm` chapter files, EPUB 3 nav documents, EPUB 2 NCX tables of contents, sparse metadata, percent-encoded chapter hrefs, or mixed HTML content that includes non-reading nodes.

## Decision

The native importer now handles common messy EPUB structures without changing the renderer contract:

- chapter manifest items may be XHTML or HTML, including `.htm` files
- spine items marked `linear="no"` are skipped
- EPUB 3 nav and EPUB 2 NCX labels can provide chapter titles
- navigation labels win over repeated in-file headings and document titles
- duplicate navigation entries that point to fragments of the same file keep the first label
- percent-encoded hrefs and fragments are normalized before reading archive entries
- missing book titles fall back to the EPUB file name
- chapter text extraction ignores non-reading HTML nodes such as `head`, `script`, `style`, `svg`, and `nav`
- native text normalization removes spaces before punctuation introduced by inline HTML

## Consequences

Import stays local and user-facing errors remain humane. The importer is still intentionally conservative: unsupported or malformed books fail with friendly messages rather than leaking parser details.

Generated native tests cover the important edge cases so future importer changes do not quietly regress real-book behavior.
