# Image Enlarge

A minimal Obsidian plugin for enlarging images. Click any image in your notes to view it in a fullscreen overlay with zoom and clipboard copy.

## Features

- **Click to enlarge** — Click any image in your markdown notes to open it in a dark overlay
- **Mouse wheel zoom** — Scroll to zoom in/out with smart 100% snap
- **Copy to clipboard** — Click the "Copy" button or press `Cmd/Ctrl+C` to copy the image as PNG
- **Download** — Save the original image to disk with one click
- **Rich markdown copy** — When copying selected markdown that contains image embeds (`![[...]]` or `![](...)`), the plugin writes both plain markdown and an HTML version with images embedded as base64 data URLs, so pasting into Gmail / Google Docs / Slack shows the images inline
- **Easy dismiss** — Click the background or press `Escape` to close

## Demo

<!-- TODO: Add demo GIF after recording -->

## Installation

### From Obsidian Community Plugins

1. Open **Settings** → **Community plugins** → **Browse**
2. Search for **Image Enlarge**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/1spread/obsidian-image-enlarge/releases/latest)
2. Create a folder `obsidian-image-enlarge` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Reload Obsidian and enable the plugin in **Settings** → **Community plugins**

## Usage

| Action | Result |
|--------|--------|
| Click an image | Opens fullscreen overlay |
| Scroll wheel | Zoom in / out |
| `Cmd/Ctrl + C` | Copy image to clipboard |
| Click background | Close overlay |
| `Escape` | Close overlay |
| Click "Copy" button | Copy image to clipboard |
| Click "Download" button / `Cmd/Ctrl + S` | Save image to disk |
| `Cmd/Ctrl + Shift + C` | Copy image path to clipboard |
| Select markdown with images, `Cmd/Ctrl + C` | Copy as rich text with embedded images for Gmail / Docs / Slack |

## Why This Plugin?

Existing image viewer plugins offer many features — rotation, flipping, color inversion, gallery mode, pin mode, and more. If you only need to **enlarge, zoom, and copy**, this plugin provides exactly that in a single lightweight file (~230 lines of TypeScript).

## Development

```bash
# Install dependencies
npm install

# Build
npm run build
```

The built `main.js` is output to the project root. If you symlink the project directory into your vault's `.obsidian/plugins/`, changes are reflected after rebuilding and reloading Obsidian (`Cmd+R`).

## Compatibility

- **Desktop only** — Uses the Clipboard API (`ClipboardItem`), which requires Electron
- **Obsidian** ≥ 0.15.0

## License

[MIT](LICENSE)
