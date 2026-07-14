use crate::narration_cache::NarrationSentenceSpan;

#[derive(Debug)]
pub struct RenderedManifestAudio {
    pub sample_rate: u32,
    pub sample_count: u64,
    pub sentences: Vec<NarrationSentenceSpan>,
    pub wav: Vec<u8>,
}
