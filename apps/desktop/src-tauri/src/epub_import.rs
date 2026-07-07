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
    if path.extension().and_then(|extension| extension.to_str()) != Some("epub") {
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
    let mut chapters = Vec::new();

    for (chapter_index, item) in package.spine.iter().enumerate() {
        let Some(href) = package.manifest.get(item) else {
            continue;
        };
        let chapter_path = normalize_epub_path(&package.base_dir, href);
        let Some(chapter_xml) = read_zip_text(&mut archive, &chapter_path) else {
            continue;
        };
        let text = extract_chapter_text(&chapter_xml);

        if text.is_empty() {
            continue;
        }

        chapters.push(ImportedChapter {
            id: format!("{book_id}:chapter-{}", chapter_index + 1),
            title: extract_chapter_title(&chapter_xml)
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
        title: package.title.unwrap_or_else(|| "Untitled Book".to_string()),
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
    manifest: HashMap<String, String>,
    spine: Vec<String>,
}

fn parse_package(xml: &str, opf_path: &str) -> Option<PackageDocument> {
    let document = roxmltree::Document::parse(xml).ok()?;
    let title = first_text(&document, "title");
    let author = first_text(&document, "creator");
    let manifest = document
        .descendants()
        .filter(|node| node.tag_name().name() == "item")
        .filter_map(|node| {
            let id = node.attribute("id")?.to_string();
            let href = node.attribute("href")?.to_string();
            let media_type = node.attribute("media-type").unwrap_or_default();

            if media_type.contains("xhtml") || href.ends_with(".xhtml") || href.ends_with(".html") {
                Some((id, href))
            } else {
                None
            }
        })
        .collect();
    let spine = document
        .descendants()
        .filter(|node| node.tag_name().name() == "itemref")
        .filter_map(|node| node.attribute("idref").map(ToString::to_string))
        .collect();

    Some(PackageDocument {
        title,
        author,
        base_dir: epub_parent(opf_path),
        manifest,
        spine,
    })
}

fn find_package_path(container_xml: &str) -> Option<String> {
    let document = roxmltree::Document::parse(container_xml).ok()?;
    document
        .descendants()
        .find(|node| node.tag_name().name() == "rootfile")
        .and_then(|node| node.attribute("full-path"))
        .map(ToString::to_string)
}

fn extract_chapter_title(xml: &str) -> Option<String> {
    let document = roxmltree::Document::parse(xml).ok()?;
    ["h1", "h2", "title"]
        .iter()
        .find_map(|tag| first_text(&document, tag))
}

fn extract_chapter_text(xml: &str) -> String {
    let Ok(document) = roxmltree::Document::parse(xml) else {
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

fn first_text(document: &roxmltree::Document<'_>, tag: &str) -> Option<String> {
    document
        .descendants()
        .find(|node| node.tag_name().name() == tag)
        .and_then(|node| node.text())
        .map(normalize_reader_text)
        .filter(|text| !text.is_empty())
}

fn collect_text(node: roxmltree::Node<'_, '_>, text: &mut String) {
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
    let joined = if base_dir.is_empty() {
        href.to_string()
    } else {
        format!("{base_dir}/{href}")
    };
    let mut parts = Vec::new();

    for part in joined.split('/') {
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
    use super::{extract_chapter_text, find_package_path, normalize_epub_path, parse_package};

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
            package.manifest.get("c1").map(String::as_str),
            Some("chapters/one.xhtml")
        );
        assert_eq!(package.spine, vec!["c1"]);
    }

    #[test]
    fn resolves_relative_epub_paths() {
        assert_eq!(
            normalize_epub_path("OPS/package", "../chapters/one.xhtml"),
            "OPS/chapters/one.xhtml"
        );
    }

    #[test]
    fn extracts_normalized_chapter_text() {
        assert_eq!(
            extract_chapter_text("<html><body><p>Hello</p><p>reader.</p></body></html>"),
            "Hello reader."
        );
    }
}
