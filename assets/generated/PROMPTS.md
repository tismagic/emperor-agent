# Generated Asset Prompts

## 2026-06-22 - `emperor-agent-logo-mark.png`

- Tool mode: built-in `image_gen` with chroma-key removal and transparent PNG post-process.
- Output: `assets/generated/emperor-agent-logo-mark.png`
- Source handling: generated on a flat `#00ff00` chroma-key background, removed with `remove_chroma_key.py`, then cropped to transparent content bounds.

Final prompt:

```text
Use case: logo-brand
Asset type: UI brand logo mark for a local AI agent desktop app
Primary request: Create a refined square brand mark for "Emperor Agent". The mark should feel like a modern command seal combined with a minimal AI/workbench symbol: a geometric imperial seal outline, subtle hexagonal structure, precise linework, premium but restrained.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for background removal.
Subject: standalone logo mark only, no words, no letters, no characters.
Style/medium: polished vector-friendly raster logo, crisp edges, minimal geometric line art with slight dimensional polish.
Composition/framing: centered square icon, generous padding, readable at 32px and 128px.
Color palette: antique gold #c69b45, warm off-white highlights, deep graphite accents; do not use #00ff00 in the subject.
Constraints: background must be one uniform #00ff00 color with no shadows, gradients, texture, reflections, floor plane, or lighting variation. Keep subject fully separated from background with crisp edges. No cast shadow, no contact shadow, no watermark, no text.
Avoid: dragons, crowns, literal emperor face, cartoon style, ornate decoration, complex tiny details, purple gradients, stock-logo look.
```

## 2026-06-22 - `emperoragent-wordmark.png`

- Tool mode: built-in `image_gen` with chroma-key removal and transparent PNG post-process.
- Output: `assets/generated/emperoragent-wordmark.png`
- Source handling: generated on a flat `#00ff00` chroma-key background, removed with `remove_chroma_key.py`, then cropped to transparent content bounds.

Final prompt:

```text
Use case: logo-brand
Asset type: horizontal UI wordmark image for the Emperor Agent desktop app
Primary request: Create a polished artistic wordmark with the exact text "emperoragent" as one lowercase word. It should pair with a restrained dark Codex-style UI: premium, quiet, technical, slightly imperial.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for background removal.
Subject: exact wordmark text "emperoragent" only, no spaces, no subtitle, no extra words. A tiny abstract seal accent before the text is allowed only if it does not change the word.
Style/medium: custom lettering, sharp modern serif-sans hybrid, high legibility at small UI sizes, subtle engraved antique-gold treatment without excessive shine.
Composition/framing: horizontal transparent-ready lockup, centered, generous padding, suitable for app empty states and sidebar header.
Color palette: antique gold #c69b45 for primary strokes, warm off-white inner highlights, small graphite shadow accents; do not use #00ff00 in the lettering.
Text (verbatim): "emperoragent"
Constraints: Render the text exactly as "emperoragent" with correct spelling, all lowercase, no spaces. The background must be one uniform #00ff00 color with no shadows, gradients, texture, reflections, floor plane, or lighting variation. Keep the lettering fully separated from background with crisp edges. No cast shadow, no contact shadow, no watermark.
Avoid: misspelled text, extra slogans, spaces between emperor and agent, uppercase letters, Chinese characters, crowns, faces, cartoon look, purple gradients, overly ornate calligraphy, thin unreadable hairlines.
```
