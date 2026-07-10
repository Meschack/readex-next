# Sonelle Product Film

Remotion source for Sonelle's 57.6-second product presentation. The film uses the app's DM Sans and Commit Mono typography, demonstrates the real reader workflow, and renders at 1920x1080 and 30 fps.

## Commands

Install the isolated video dependencies:

```console
npm install
```

Open Remotion Studio:

```console
npm run dev
```

Run formatting, lint, and TypeScript checks:

```console
npx prettier --check .
npm run lint
```

Render the final H.264 film:

```console
npx remotion render src/index.ts SonelleProductFilm out/sonelle-product-film.mp4 --codec=h264 --crf=18
```

The `out/` directory is intentionally ignored. Commit the composition and source assets, then reproduce delivery files locally or in CI.
