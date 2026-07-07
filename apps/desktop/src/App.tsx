import "./App.css";

const sampleSentences = [
  "The room was quiet enough to hear the rain tapping against the glass.",
  "Mara followed the line with her finger, letting the voice carry the sentence ahead.",
  "When the word felt unfamiliar, she paused and opened its meaning without leaving the page."
];

function App() {
  return (
    <main class="readex-shell">
      <aside class="library-rail" aria-label="Library">
        <strong class="brand">Readex</strong>
        <nav class="nav-list">
          <a class="active" href="/">
            Reader
          </a>
          <a href="/">Library</a>
          <a href="/">Bookmarks</a>
          <a href="/">Words</a>
        </nav>
      </aside>

      <section class="reader-surface" aria-label="Reader">
        <header class="reader-header">
          <p>Listening Manuscript</p>
          <h1>A sentence-first reading desk</h1>
        </header>

        <div class="reader-layout">
          <div class="audio-margin" aria-hidden="true">
            {sampleSentences.map((_, index) => (
              <span class={index === 1 ? "marker active" : "marker"} />
            ))}
          </div>

          <article class="page">
            {sampleSentences.map((sentence, index) => (
              <p class={index === 1 ? "sentence active" : "sentence"}>{sentence}</p>
            ))}
          </article>
        </div>
      </section>

      <aside class="inspector" aria-label="Word insight">
        <span class="inspector-label">Word insight</span>
        <strong>unfamiliar</strong>
        <p>Click or select a word to inspect meaning, translation, pronunciation, and notes.</p>
      </aside>

      <footer class="audio-rail" aria-label="Playback controls">
        <span>Chapter 1</span>
        <button type="button" aria-label="Previous sentence">
          Prev
        </button>
        <button class="play" type="button" aria-label="Play">
          Play
        </button>
        <button type="button" aria-label="Next sentence">
          Next
        </button>
        <span class="mono">1.00x</span>
      </footer>
    </main>
  );
}

export default App;
