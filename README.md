# Image Workflow

An image-centric workflow plugin for Obsidian. Click images to enlarge with zoom, copy / download, and copy markdown selections so images paste inline into Gmail, Google Docs, Slack, etc.

## Features

- **Click to enlarge** — Click any image in your markdown notes to open it in a dark overlay
- **Mouse wheel zoom** — Scroll to zoom in/out with smart 100% snap
- **Copy / Download** — Copy image as PNG, save the original to disk, or copy the vault path
- **Rich markdown copy** — When copying selected markdown that contains image embeds (`![[...]]` or `![](...)`), the plugin writes both plain markdown and an HTML version with images embedded as base64 data URLs, so pasting into Gmail / Google Docs / Slack shows the images inline
- **Smart paste-back** — Pasting that rich clipboard back into Obsidian inserts the original `![[...]]` markdown (no base64 bloat)
- **Copy as HTML with embedded images (command)** — Bind a hotkey to render the selection through Obsidian's Markdown renderer (headings, lists, callouts, etc.) and write rich HTML with embedded images
- **Easy dismiss** — Click the background or press `Escape` to close

## Installation

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/1spread/image-workflow/releases/latest)
2. Create a folder `image-workflow` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Reload Obsidian and enable the plugin in **Settings** → **Community plugins**

## Usage

| Action | Result |
|--------|--------|
| Click an image | Opens fullscreen overlay |
| Scroll wheel | Zoom in / out |
| `Cmd/Ctrl + C` (overlay) | Copy image to clipboard |
| Click "Copy" button | Copy image to clipboard |
| Click "Download" button / `Cmd/Ctrl + S` | Save image to disk |
| `Cmd/Ctrl + Shift + C` (overlay) | Copy image path to clipboard |
| Click background / `Escape` | Close overlay |
| Select markdown with images, `Cmd/Ctrl + C` | Copy as rich text with embedded images for Gmail / Docs / Slack |
| Command: *Copy selection as HTML with embedded images* | Full Markdown-rendered HTML + embedded images (assignable hotkey) |

## Development

```bash
npm install
npm run build
```

The built `main.js` is output to the project root. Symlink the project directory into `.obsidian/plugins/image-workflow/` for live development.

## Compatibility

- **Desktop only** — Uses the Clipboard API (`ClipboardItem`), which requires Electron
- **Obsidian** ≥ 0.15.0

## License

[MIT](LICENSE)
