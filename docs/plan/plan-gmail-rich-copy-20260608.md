# plan-gmail-rich-copy-20260608

## Goal

Explain why pasted content can break in Gmail, then adjust the plugin so selected Obsidian content with images/tables is copied as stable rich HTML instead of a fragile markdown-derived fragment.

## Current Hypothesis

- Auto copy currently intercepts any selection containing an image reference.
- It likely builds rich HTML from the raw selected markdown in some cases.
- Gmail expects valid, self-contained HTML; raw markdown tables, Obsidian embeds, or partially converted image syntax can paste as broken text or malformed layout.

## Steps

- [x] Inspect repository and existing copy/paste workflow.
- [x] Find the HTML generation path and table/image conversion behavior.
- [x] Update copy behavior to prefer Markdown-rendered HTML for selected content.
- [x] Preserve plain-text markdown fallback for pasting back into Obsidian.
- [x] Build and verify no TypeScript/bundle errors.
- [x] Summarize user-facing cause and usage notes.

## Result

- Root cause: auto-copy used a lightweight markdown-to-HTML fragment that only replaced image references and joined lines with `<br>`. Markdown tables therefore stayed as pipe-delimited text instead of valid HTML tables, which can break when pasted into Gmail.
- Fix: auto-copy now uses Obsidian's MarkdownRenderer, the same rich path as the command copy flow, then inlines rendered images for external paste targets.
- Plain text is still written to the clipboard, so pasting the rich clipboard back into Obsidian can restore the original markdown selection.
- Verification: `npm run build` completed successfully.

## Google Docs Follow-up

- [x] Wrap clipboard HTML as a complete document with explicit fragment markers.
- [x] Add Google Docs-friendly inline styles for paragraphs, images, and tables.
- [x] Preserve embedded image data URLs for Google paste targets.
- [x] Rebuild and verify.

## Google Docs Result

- Clipboard HTML now includes `<!DOCTYPE html>`, UTF-8 metadata, and `StartFragment` / `EndFragment` markers so Google Docs can identify the intended pasted fragment.
- Paragraphs, tables, table cells, and images now get conservative inline styles because Google Docs strips or rewrites many external/class-based styles on paste.
- Images keep explicit width/height attributes when available and use block-level `max-width:100%` styling for more predictable Docs insertion.
- Verification: `npm run build` completed successfully after the follow-up changes.

## Line Break Follow-up

- [x] Add a setting to preserve soft line breaks as visible line breaks in Google paste HTML.
- [x] Keep markdown source/plain-text clipboard data unchanged.
- [x] Avoid changing code blocks and table structure unexpectedly.
- [x] Rebuild and verify.

## Line Break Result

- Added `Preserve line breaks for Google paste`, enabled by default. It converts newline characters inside rendered paragraphs/table cells into `<br>` tags for the HTML clipboard payload.
- Added `Format all markdown copies for Google apps`, disabled by default. When enabled, regular Cmd/Ctrl+C on any markdown selection uses the Google Docs-friendly HTML path, even without images.
- Code blocks are left out of the soft-line-break conversion path and continue to use the existing Docs-friendly code-block table conversion.
- Verification: `npm run build` completed successfully after the line-break changes.
