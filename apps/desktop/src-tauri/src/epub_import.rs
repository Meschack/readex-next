use std::{
    collections::HashMap,
    fmt,
    fs::File,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::text::normalize_reader_text;

#[derive(Debug, Clone)]
pub struct ImportedBook {
    pub id: String,
    pub title: String,
    pub author: String,
    pub source_path: String,
    pub chapters: Vec<ImportedChapter>,
}

#[derive(Debug, Clone)]
pub struct ImportedChapter {
    pub id: String,
    pub title: String,
    pub index: usize,
    pub body: String,
}

#[derive(Debug)]
pub enum ImportError {
    EmptyBook,
    InvalidArchive,
    MissingContainer,
    MissingPackage,
    MissingSpine,
    ReadFailed(String),
}

impl fmt::Display for ImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ImportError::EmptyBook => {
                write!(
                    formatter,
                    "We couldn't find readable chapter text in that EPUB."
                )
            }
            ImportError::InvalidArchive => {
                write!(formatter, "That file does not look like an EPUB.")
            }
            ImportError::MissingContainer => {
                write!(formatter, "That EPUB is missing its reading manifest.")
            }
            ImportError::MissingPackage => {
                write!(formatter, "That EPUB is missing its book metadata.")
            }
            ImportError::MissingSpine => {
                write!(
                    formatter,
                    "That EPUB does not include a readable chapter order."
                )
            }
            ImportError::ReadFailed(message) => write!(formatter, "{message}"),
        }
    }
}

pub fn import_epub_file(path: &Path) -> Result<ImportedBook, ImportError> {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("epub"))
    {
        return Err(ImportError::InvalidArchive);
    }

    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|_| ImportError::ReadFailed("We couldn't open that EPUB.".to_string()))?;

    let hash = Sha256::digest(&bytes);
    let book_id = format!("book-{}", hex_prefix(&hash, 16));
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| ImportError::InvalidArchive)?;
    let container = read_zip_text(&mut archive, "META-INF/container.xml")
        .ok_or(ImportError::MissingContainer)?;
    let opf_path = find_package_path(&container).ok_or(ImportError::MissingContainer)?;
    let opf = read_zip_text(&mut archive, &opf_path).ok_or(ImportError::MissingPackage)?;
    let package = parse_package(&opf, &opf_path).ok_or(ImportError::MissingPackage)?;
    let navigation_titles = read_navigation_titles(&mut archive, &package);
    let mut chapters = Vec::new();

    for (chapter_index, item) in package.spine.iter().enumerate() {
        if !item.linear {
            continue;
        }

        let Some(manifest_item) = package.manifest.get(&item.idref) else {
            continue;
        };
        let chapter_path = normalize_epub_path(&package.base_dir, &manifest_item.href);
        let Some(chapter_xml) = read_zip_text(&mut archive, &chapter_path) else {
            continue;
        };
        let text = extract_chapter_text(&chapter_xml);

        if text.is_empty() {
            continue;
        }

        chapters.push(ImportedChapter {
            id: format!("{book_id}:chapter-{}", chapter_index + 1),
            title: navigation_titles
                .get(&chapter_path)
                .cloned()
                .or_else(|| extract_chapter_heading(&chapter_xml))
                .or_else(|| extract_document_title(&chapter_xml))
                .unwrap_or_else(|| format!("Chapter {}", chapter_index + 1)),
            index: chapter_index,
            body: text,
        });
    }

    if package.spine.is_empty() {
        return Err(ImportError::MissingSpine);
    }

    if chapters.is_empty() {
        return Err(ImportError::EmptyBook);
    }

    Ok(ImportedBook {
        id: book_id,
        title: package.title.unwrap_or_else(|| fallback_book_title(path)),
        author: package
            .author
            .unwrap_or_else(|| "Unknown author".to_string()),
        source_path: path.to_string_lossy().to_string(),
        chapters,
    })
}

#[derive(Debug)]
struct PackageDocument {
    title: Option<String>,
    author: Option<String>,
    base_dir: String,
    manifest: HashMap<String, ManifestItem>,
    spine: Vec<SpineItem>,
    nav_path: Option<String>,
    ncx_path: Option<String>,
}

#[derive(Debug, Clone)]
struct ManifestItem {
    href: String,
    media_type: String,
    properties: String,
}

#[derive(Debug, Clone)]
struct SpineItem {
    idref: String,
    linear: bool,
}

fn parse_package(xml: &str, opf_path: &str) -> Option<PackageDocument> {
    let document = parse_epub_xml(xml).ok()?;
    let title = first_text(&document, "title");
    let author = first_text(&document, "creator");
    let all_manifest_items = document
        .descendants()
        .filter(|node| node.tag_name().name() == "item")
        .filter_map(|node| {
            let id = node.attribute("id")?.to_string();
            let href = node.attribute("href")?.to_string();
            let media_type = node.attribute("media-type").unwrap_or_default().to_string();
            let properties = node.attribute("properties").unwrap_or_default().to_string();

            Some((
                id,
                ManifestItem {
                    href,
                    media_type,
                    properties,
                },
            ))
        })
        .collect::<HashMap<_, _>>();
    let manifest = all_manifest_items
        .iter()
        .filter(|(_, item)| is_readable_manifest_item(item))
        .map(|(id, item)| (id.clone(), item.clone()))
        .collect();
    let spine_node = document
        .descendants()
        .find(|node| node.tag_name().name() == "spine");
    let ncx_path = spine_node
        .and_then(|node| node.attribute("toc"))
        .and_then(|id| all_manifest_items.get(id))
        .map(|item| normalize_epub_path(&epub_parent(opf_path), &item.href));
    let spine = document
        .descendants()
        .filter(|node| node.tag_name().name() == "itemref")
        .filter_map(|node| {
            Some(SpineItem {
                idref: node.attribute("idref")?.to_string(),
                linear: node.attribute("linear") != Some("no"),
            })
        })
        .collect();
    let nav_path = all_manifest_items
        .values()
        .find(|item| {
            item.properties
                .split_whitespace()
                .any(|value| value == "nav")
        })
        .map(|item| normalize_epub_path(&epub_parent(opf_path), &item.href));

    Some(PackageDocument {
        title,
        author,
        base_dir: epub_parent(opf_path),
        manifest,
        spine,
        nav_path,
        ncx_path,
    })
}

fn is_readable_manifest_item(item: &ManifestItem) -> bool {
    let href = strip_href_fragment(&item.href).to_ascii_lowercase();
    let media_type = item.media_type.to_ascii_lowercase();

    media_type.contains("xhtml")
        || media_type == "text/html"
        || href.ends_with(".xhtml")
        || href.ends_with(".html")
        || href.ends_with(".htm")
}

fn find_package_path(container_xml: &str) -> Option<String> {
    let document = parse_epub_xml(container_xml).ok()?;
    document
        .descendants()
        .find(|node| node.tag_name().name() == "rootfile")
        .and_then(|node| node.attribute("full-path"))
        .map(ToString::to_string)
}

fn read_navigation_titles(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    package: &PackageDocument,
) -> HashMap<String, String> {
    let mut titles = HashMap::new();

    if let Some(nav_path) = &package.nav_path {
        if let Some(nav_xml) = read_zip_text(archive, nav_path) {
            merge_navigation_titles(&mut titles, parse_epub3_nav_titles(&nav_xml, nav_path));
        }
    }

    if let Some(ncx_path) = &package.ncx_path {
        if let Some(ncx_xml) = read_zip_text(archive, ncx_path) {
            merge_navigation_titles(&mut titles, parse_ncx_titles(&ncx_xml, ncx_path));
        }
    }

    titles
}

fn merge_navigation_titles(target: &mut HashMap<String, String>, source: HashMap<String, String>) {
    for (path, title) in source {
        target.entry(path).or_insert(title);
    }
}

fn parse_epub3_nav_titles(xml: &str, nav_path: &str) -> HashMap<String, String> {
    let Ok(document) = parse_epub_xml(xml) else {
        return HashMap::new();
    };
    let nav_base_dir = epub_parent(nav_path);
    let toc_nav = document
        .descendants()
        .find(|node| node.tag_name().name() == "nav" && has_epub_type(node, "toc"))
        .unwrap_or_else(|| document.root_element());

    let mut titles = HashMap::new();

    for node in toc_nav
        .descendants()
        .filter(|node| node.tag_name().name() == "a")
    {
        let Some(href) = node.attribute("href") else {
            continue;
        };
        let title = normalize_reader_text(&node_text(node));
        if title.is_empty() {
            continue;
        }

        titles
            .entry(normalize_epub_path(&nav_base_dir, href))
            .or_insert(title);
    }

    titles
}

fn has_epub_type(node: &roxmltree::Node<'_, '_>, expected_type: &str) -> bool {
    node.attributes().any(|attribute| {
        attribute.name() == "type"
            && attribute
                .value()
                .split_whitespace()
                .any(|value| value == expected_type)
    })
}

fn parse_ncx_titles(xml: &str, ncx_path: &str) -> HashMap<String, String> {
    let Ok(document) = parse_epub_xml(xml) else {
        return HashMap::new();
    };
    let ncx_base_dir = epub_parent(ncx_path);

    let mut titles = HashMap::new();

    for node in document
        .descendants()
        .filter(|node| node.tag_name().name() == "navPoint")
    {
        let Some(src) = node
            .descendants()
            .find(|child| child.tag_name().name() == "content")
            .and_then(|child| child.attribute("src"))
        else {
            continue;
        };
        let Some(title) = node
            .descendants()
            .find(|child| child.tag_name().name() == "navLabel")
            .map(node_text)
            .map(|value| normalize_reader_text(&value))
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        titles
            .entry(normalize_epub_path(&ncx_base_dir, src))
            .or_insert(title);
    }

    titles
}

fn extract_chapter_heading(xml: &str) -> Option<String> {
    let document = parse_epub_xml(xml).ok()?;
    ["h1", "h2"]
        .iter()
        .find_map(|tag| first_text(&document, tag))
}

fn extract_document_title(xml: &str) -> Option<String> {
    let document = parse_epub_xml(xml).ok()?;
    first_text(&document, "title")
}

fn extract_chapter_text(xml: &str) -> String {
    let Ok(document) = parse_epub_xml(xml) else {
        return String::new();
    };
    let body = document
        .descendants()
        .find(|node| node.tag_name().name() == "body")
        .unwrap_or_else(|| document.root_element());
    let mut text = String::new();

    collect_text(body, &mut text);
    normalize_reader_text(&text)
}

fn parse_epub_xml(xml: &str) -> Result<roxmltree::Document<'_>, roxmltree::Error> {
    roxmltree::Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..roxmltree::ParsingOptions::default()
        },
    )
}

fn first_text(document: &roxmltree::Document<'_>, tag: &str) -> Option<String> {
    document
        .descendants()
        .find(|node| node.tag_name().name() == tag)
        .map(node_text)
        .map(|text| normalize_reader_text(&text))
        .filter(|text| !text.is_empty())
}

fn collect_text(node: roxmltree::Node<'_, '_>, text: &mut String) {
    if should_skip_text_node(node) {
        return;
    }

    if node.is_text() {
        if let Some(value) = node.text() {
            text.push(' ');
            text.push_str(value);
        }
    }

    for child in node.children() {
        collect_text(child, text);
    }
}

fn should_skip_text_node(node: roxmltree::Node<'_, '_>) -> bool {
    node.ancestors().any(|ancestor| {
        matches!(
            ancestor.tag_name().name(),
            "head" | "script" | "style" | "svg" | "nav"
        )
    })
}

fn node_text(node: roxmltree::Node<'_, '_>) -> String {
    let mut text = String::new();

    for descendant in node.descendants().filter(|descendant| descendant.is_text()) {
        if let Some(value) = descendant.text() {
            text.push(' ');
            text.push_str(value);
        }
    }

    text
}

fn read_zip_text(archive: &mut ZipArchive<Cursor<Vec<u8>>>, path: &str) -> Option<String> {
    let mut file = archive.by_name(path).ok()?;
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    Some(text)
}

fn epub_parent(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(PathBuf::from)
        .unwrap_or_default()
        .to_string_lossy()
        .replace('\\', "/")
}

fn normalize_epub_path(base_dir: &str, href: &str) -> String {
    let href = strip_href_fragment(href);
    let joined = if base_dir.is_empty() {
        href.to_string()
    } else {
        format!("{base_dir}/{href}")
    };
    let decoded = percent_decode_path(&joined);
    let mut parts = Vec::new();

    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            value => parts.push(value),
        }
    }

    parts.join("/")
}

fn strip_href_fragment(href: &str) -> &str {
    href.split_once('#')
        .map(|(path, _fragment)| path)
        .unwrap_or(href)
}

fn percent_decode_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = hex_value(bytes[index + 1]);
            let low = hex_value(bytes[index + 2]);

            if let (Some(high), Some(low)) = (high, low) {
                output.push(high * 16 + low);
                index += 3;
                continue;
            }
        }

        output.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&output).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn fallback_book_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.replace(['_', '-'], " "))
        .map(|stem| normalize_reader_text(&stem))
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "Untitled Book".to_string())
}

fn hex_prefix(bytes: &[u8], length: usize) -> String {
    bytes
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .take(length)
        .map(|nibble| char::from_digit(nibble.into(), 16).unwrap_or('0'))
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{Seek, Write},
        path::{Path, PathBuf},
    };

    use chrono::Utc;
    use zip::{write::SimpleFileOptions, ZipWriter};

    use super::{
        extract_chapter_heading, extract_chapter_text, find_package_path, import_epub_file,
        normalize_epub_path, parse_epub3_nav_titles, parse_ncx_titles, parse_package,
    };

    #[test]
    fn finds_the_package_path_from_container_xml() {
        let container = r#"<?xml version="1.0"?>
        <container>
          <rootfiles>
            <rootfile full-path="OPS/content.opf" />
          </rootfiles>
        </container>"#;

        assert_eq!(
            find_package_path(container).as_deref(),
            Some("OPS/content.opf")
        );
    }

    #[test]
    fn parses_metadata_manifest_and_spine() {
        let package = parse_package(
            r#"<package xmlns:dc="http://purl.org/dc/elements/1.1/">
              <metadata><dc:title>Book</dc:title><dc:creator>Author</dc:creator></metadata>
              <manifest><item id="c1" href="chapters/one.xhtml" media-type="application/xhtml+xml"/></manifest>
              <spine><itemref idref="c1"/></spine>
            </package>"#,
            "OPS/content.opf",
        )
        .expect("package should parse");

        assert_eq!(package.title.as_deref(), Some("Book"));
        assert_eq!(package.author.as_deref(), Some("Author"));
        assert_eq!(
            package.manifest.get("c1").map(|item| item.href.as_str()),
            Some("chapters/one.xhtml")
        );
        assert_eq!(package.spine[0].idref, "c1");
        assert!(package.spine[0].linear);
    }

    #[test]
    fn resolves_relative_epub_paths() {
        assert_eq!(
            normalize_epub_path("OPS/package", "../chapters/one.xhtml"),
            "OPS/chapters/one.xhtml"
        );
        assert_eq!(
            normalize_epub_path("OPS/package", "../chapters/one%20more.xhtml#part"),
            "OPS/chapters/one more.xhtml"
        );
        assert_eq!(
            normalize_epub_path("OPS/package", "../chapters/caf%C3%A9.xhtml"),
            "OPS/chapters/café.xhtml"
        );
    }

    #[test]
    fn extracts_visible_chapter_heading_before_document_title() {
        assert_eq!(
            extract_chapter_heading(
                "<html><head><title>Generic File Title</title></head><body><h2>Visible Chapter</h2></body></html>"
            )
            .as_deref(),
            Some("Visible Chapter")
        );
    }

    #[test]
    fn extracts_heading_text_after_inline_anchor() {
        assert_eq!(
            extract_chapter_heading(
                "<html><head><title>Repeated Book</title></head><body><h2><a id=\"chapter\"/>Actual Chapter</h2></body></html>"
            )
            .as_deref(),
            Some("Actual Chapter")
        );
    }

    #[test]
    fn extracts_normalized_chapter_text() {
        assert_eq!(
            extract_chapter_text(
                "<html><head><style>Ignore</style></head><body><nav>Skip me</nav><p>Hello</p><script>Nope</script><p>reader.</p></body></html>"
            ),
            "Hello reader."
        );
    }

    #[test]
    fn extracts_chapter_text_from_xhtml_with_doctype() {
        assert_eq!(
            extract_chapter_text(
                r#"<?xml version="1.0" encoding="utf-8"?>
                <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"
                  "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
                <html xmlns="http://www.w3.org/1999/xhtml">
                  <body><h1>Introduction</h1><p>Readable text.</p></body>
                </html>"#
            ),
            "Introduction Readable text."
        );
    }

    #[test]
    fn parses_ncx_labels_by_resolved_content_path() {
        let titles = parse_ncx_titles(
            r#"<ncx>
              <navMap>
                <navPoint>
                  <navLabel><text>Deep Chapter</text></navLabel>
                  <content src="../text/deep.xhtml#start" />
                </navPoint>
              </navMap>
            </ncx>"#,
            "OPS/nav/toc.ncx",
        );

        assert_eq!(
            titles.get("OPS/text/deep.xhtml").map(String::as_str),
            Some("Deep Chapter")
        );
    }

    #[test]
    fn parses_ncx_labels_with_doctype_and_namespace() {
        let titles = parse_ncx_titles(
            r#"<?xml version="1.0"?>
            <!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
            <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
              <navMap>
                <navPoint>
                  <navLabel><text>Namespaced Chapter</text></navLabel>
                  <content src="chapter.xhtml" />
                </navPoint>
              </navMap>
            </ncx>"#,
            "OPS/toc.ncx",
        );

        assert_eq!(
            titles.get("OPS/chapter.xhtml").map(String::as_str),
            Some("Namespaced Chapter")
        );
    }

    #[test]
    fn keeps_first_navigation_label_for_split_files_with_fragments() {
        let titles = parse_ncx_titles(
            r#"<ncx>
              <navMap>
                <navPoint>
                  <navLabel><text>About the Author</text></navLabel>
                  <content src="front.xhtml" />
                </navPoint>
                <navPoint>
                  <navLabel><text>Copyright Page</text></navLabel>
                  <content src="front.xhtml#copyright" />
                </navPoint>
              </navMap>
            </ncx>"#,
            "OPS/toc.ncx",
        );

        assert_eq!(
            titles.get("OPS/front.xhtml").map(String::as_str),
            Some("About the Author")
        );
    }

    #[test]
    fn parses_epub3_toc_without_landmark_overrides() {
        let titles = parse_epub3_nav_titles(
            r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
              <body>
                <nav epub:type="toc">
                  <ol><li><a href="../text/chapter.xhtml">Chapter Label</a></li></ol>
                </nav>
                <nav epub:type="landmarks">
                  <ol><li><a href="../text/chapter.xhtml">Start Reading</a></li></ol>
                </nav>
              </body>
            </html>"#,
            "OPS/nav/nav.xhtml",
        );

        assert_eq!(
            titles.get("OPS/text/chapter.xhtml").map(String::as_str),
            Some("Chapter Label")
        );
    }

    #[test]
    fn imports_sparse_nested_epub_with_navigation_titles_and_mixed_html() {
        let temp_dir = temp_epub_dir();
        fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        let epub_path = temp_dir.join("Sparse_Book.epub");
        write_epub(
            &epub_path,
            [
                (
                    "META-INF/container.xml",
                    r#"<?xml version="1.0"?>
                    <container>
                      <rootfiles>
                        <rootfile full-path="OPS/package/content.opf" />
                      </rootfiles>
                    </container>"#,
                ),
                (
                    "OPS/package/content.opf",
                    r#"<package xmlns:dc="http://purl.org/dc/elements/1.1/">
                      <metadata></metadata>
                      <manifest>
                        <item id="nav" href="../nav/nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                        <item id="c1" href="../Text/intro.htm" media-type="text/html" />
                        <item id="skip" href="../Text/skip.xhtml" media-type="application/xhtml+xml" />
                        <item id="c2" href="../Text/encoded%20chapter.xhtml" media-type="application/xhtml+xml" />
                      </manifest>
                      <spine>
                        <itemref idref="c1" />
                        <itemref idref="skip" linear="no" />
                        <itemref idref="c2" />
                      </spine>
                    </package>"#,
                ),
                (
                    "OPS/nav/nav.xhtml",
                    r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
                      <body>
                        <nav epub:type="toc">
                          <ol>
                            <li><a href="../Text/intro.htm">Opening From Nav</a></li>
                            <li><a href="../Text/encoded%20chapter.xhtml#part">Encoded Path</a></li>
                          </ol>
                        </nav>
                      </body>
                    </html>"#,
                ),
                (
                    "OPS/Text/intro.htm",
                    r#"<html><body>
                      <nav>This should not be read.</nav>
                      <p>Hello <span>reader</span>.</p>
                      <script>Also skipped.</script>
                    </body></html>"#,
                ),
                (
                    "OPS/Text/skip.xhtml",
                    r#"<html><body><p>Linear no should stay out.</p></body></html>"#,
                ),
                (
                    "OPS/Text/encoded chapter.xhtml",
                    r#"<html><body><p>Second readable chapter.</p></body></html>"#,
                ),
            ],
        );

        let book = import_epub_file(&epub_path).expect("epub should import");

        assert_eq!(book.title, "Sparse Book");
        assert_eq!(book.author, "Unknown author");
        assert_eq!(book.chapters.len(), 2);
        assert_eq!(book.chapters[0].title, "Opening From Nav");
        assert_eq!(book.chapters[0].body, "Hello reader.");
        assert_eq!(book.chapters[1].title, "Encoded Path");
        assert_eq!(book.chapters[1].body, "Second readable chapter.");

        fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn imports_navigation_title_before_repeated_document_heading() {
        let temp_dir = temp_epub_dir();
        fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        let epub_path = temp_dir.join("Repeated_Title.epub");
        write_epub(
            &epub_path,
            [
                (
                    "META-INF/container.xml",
                    r#"<?xml version="1.0"?>
                    <container>
                      <rootfiles>
                        <rootfile full-path="OPS/content.opf" />
                      </rootfiles>
                    </container>"#,
                ),
                (
                    "OPS/content.opf",
                    r#"<package xmlns:dc="http://purl.org/dc/elements/1.1/">
                      <metadata><dc:title>Repeated Book</dc:title></metadata>
                      <manifest>
                        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
                        <item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml" />
                      </manifest>
                      <spine toc="ncx"><itemref idref="c1" /></spine>
                    </package>"#,
                ),
                (
                    "OPS/toc.ncx",
                    r#"<ncx>
                      <navMap>
                        <navPoint>
                          <navLabel><text>Actual Chapter Name</text></navLabel>
                          <content src="text/one.xhtml#start" />
                        </navPoint>
                      </navMap>
                    </ncx>"#,
                ),
                (
                    "OPS/text/one.xhtml",
                    r#"<html><head><title>Repeated Book</title></head><body>
                      <h1>Repeated Book</h1>
                      <p>Readable chapter text.</p>
                    </body></html>"#,
                ),
            ],
        );

        let book = import_epub_file(&epub_path).expect("epub should import");

        assert_eq!(book.chapters[0].title, "Actual Chapter Name");

        fs::remove_dir_all(temp_dir).ok();
    }

    fn write_epub<const N: usize>(path: &Path, entries: [(&str, &str); N]) {
        let file = fs::File::create(path).expect("epub file should be created");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        for (name, contents) in entries {
            writer
                .start_file(name, options)
                .expect("zip entry should start");
            writer
                .write_all(contents.as_bytes())
                .expect("zip entry should be written");
        }

        finish_zip(writer);
    }

    fn finish_zip<W: Write + Seek>(writer: ZipWriter<W>) {
        writer.finish().expect("zip should finish");
    }

    fn temp_epub_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "readex-epub-import-test-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }
}
