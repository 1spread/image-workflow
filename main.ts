import { FileSystemAdapter, Notice, Plugin, Scope, TFile } from 'obsidian';

const IMG_SELECTOR = `.workspace-leaf-content[data-type='markdown'] img:not(a img), .workspace-leaf-content[data-type='image'] img`;
const ZOOM_FACTOR = 0.8;
const IMG_VIEW_MIN = 30;
const BUTTON_AREA_HEIGHT = 100; // bottom button group clearance
const MAX_CANVAS_DIM = 8192;
const MAX_EMBED_BYTES = 5 * 1024 * 1024; // 5MB per image

const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

interface ImgInfo {
  curWidth: number;
  curHeight: number;
  realWidth: number;
  realHeight: number;
  left: number;
  top: number;
}

export default class ImageEnlargePlugin extends Plugin {
  private overlayEl: HTMLDivElement | null = null;
  private imgInfo: ImgInfo = { curWidth: 0, curHeight: 0, realWidth: 0, realHeight: 0, left: 0, top: 0 };
  private overlayScope: Scope | null = null;
  private overlayAbortController: AbortController | null = null;
  private rafId: number | null = null;

  private handleImageClick = (evt: MouseEvent) => {
    const target = evt.target as HTMLElement;
    const img = target instanceof HTMLImageElement
      ? target
      : target.closest('img');
    if (!img || !(img instanceof HTMLImageElement)) return;
    if (!img.matches(IMG_SELECTOR)) return;
    if (this.overlayEl) return;
    evt.preventDefault();
    evt.stopPropagation(); // Obsidian 側のハンドラが画像を別ペインで開くのを防ぐ
    this.openOverlay(img.src);
  };

  private handleCopy = (evt: ClipboardEvent) => {
    const target = evt.target as HTMLElement | null;
    // Only intercept copies originating from a markdown leaf
    if (!target || !target.closest(`.workspace-leaf-content[data-type='markdown']`)) return;

    const selection = window.getSelection();
    const text = selection?.toString();
    if (!text) return;

    if (!hasImageRef(text)) return;

    // We will handle this copy: prevent default and write asynchronously.
    evt.preventDefault();
    evt.stopPropagation();
    void this.writeRichClipboard(text);
  };

  onload() {
    // capture: true — Obsidian/CM6 の stopPropagation より先に発火
    this.registerDomEvent(document, 'click', this.handleImageClick, true);
    this.registerDomEvent(document, 'copy', this.handleCopy, true);
  }

  onunload() {
    this.closeOverlay();
  }

  private openOverlay(src: string) {
    if (this.overlayEl) return;

    const overlay = document.createElement('div');
    overlay.addClass('image-enlarge-overlay');
    this.overlayEl = overlay;

    const imgView = document.createElement('img');
    imgView.addClass('image-enlarge-view');
    imgView.src = src;

    const btnGroup = document.createElement('div');
    btnGroup.addClass('image-enlarge-btn-group');

    const copyBtn = document.createElement('button');
    copyBtn.addClass('image-enlarge-btn');
    copyBtn.textContent = 'Copy';

    const downloadBtn = document.createElement('button');
    downloadBtn.addClass('image-enlarge-btn');
    downloadBtn.textContent = 'Download';

    const copyPathBtn = document.createElement('button');
    copyPathBtn.addClass('image-enlarge-btn');
    copyPathBtn.textContent = 'Copy Path';

    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(downloadBtn);
    btnGroup.appendChild(copyPathBtn);
    overlay.appendChild(imgView);
    overlay.appendChild(btnGroup);
    document.body.appendChild(overlay);

    if (imgView.complete && imgView.naturalWidth > 0) {
      this.calculateFitSize(imgView);
    } else {
      imgView.onload = () => {
        if (!this.overlayEl) return;
        this.calculateFitSize(imgView);
      };
    }

    const controller = new AbortController();
    this.overlayAbortController = controller;
    const { signal } = controller;

    imgView.addEventListener('dragstart', (e) => e.preventDefault(), { signal });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeOverlay();
    }, { signal });

    this.overlayScope = new Scope();
    this.overlayScope.register(null, 'Escape', () => {
      this.closeOverlay();
      return false;
    });
    this.overlayScope.register(['Mod'], 'c', () => {
      this.copyImageToClipboard(imgView);
      return false;
    });
    this.overlayScope.register(['Mod', 'Shift'], 'c', () => {
      this.copyImagePath(src);
      return false;
    });
    this.overlayScope.register(['Mod'], 's', () => {
      this.downloadImage(src);
      return false;
    });
    this.app.keymap.pushScope(this.overlayScope);

    imgView.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomIn = e.deltaY < 0;
      const ratio = zoomIn ? 0.1 : -0.1;
      const rect = imgView.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.zoom(ratio, { offsetX, offsetY });
        this.applyTransform(imgView);
      });
    }, { signal });

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyImageToClipboard(imgView);
    }, { signal });

    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.downloadImage(src);
    }, { signal });

    copyPathBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyImagePath(src);
    }, { signal });
  }

  private calculateFitSize(imgView: HTMLImageElement) {
    const winW = document.documentElement.clientWidth;
    const winH = document.documentElement.clientHeight - BUTTON_AREA_HEIGHT;
    const zoomW = winW * ZOOM_FACTOR;
    const zoomH = winH * ZOOM_FACTOR;

    let w = imgView.naturalWidth, h = imgView.naturalHeight;
    if (h > zoomH) {
      h = zoomH;
      w = h / imgView.naturalHeight * imgView.naturalWidth;
      if (w > zoomW) w = zoomW;
    } else if (w > zoomW) {
      w = zoomW;
    }
    h = w * imgView.naturalHeight / imgView.naturalWidth;

    this.imgInfo = {
      curWidth: w,
      curHeight: h,
      realWidth: imgView.naturalWidth,
      realHeight: imgView.naturalHeight,
      left: (winW - w) / 2,
      top: (winH - h) / 2,
    };
    this.applyTransform(imgView);
  }

  private zoom(ratio: number, offset: { offsetX: number; offsetY: number }) {
    const info = this.imgInfo;
    const zoomIn = ratio > 0;
    const multiplier = zoomIn ? 1 + ratio : 1 / (1 - ratio);
    let zoomRatio = info.curWidth * multiplier / info.realWidth;

    const curRatio = info.curWidth / info.realWidth;
    if ((curRatio < 1 && zoomRatio > 1) || (curRatio > 1 && zoomRatio < 1)) {
      zoomRatio = 1;
      const snapMultiplier = 1 / curRatio;
      info.left += offset.offsetX * (1 - snapMultiplier);
      info.top += offset.offsetY * (1 - snapMultiplier);
      info.curWidth = info.realWidth;
      info.curHeight = info.realHeight;
      return;
    }

    let newW = info.realWidth * zoomRatio;
    let newH = info.realHeight * zoomRatio;

    if (newW < IMG_VIEW_MIN || newH < IMG_VIEW_MIN) {
      if (newW < IMG_VIEW_MIN) {
        newW = IMG_VIEW_MIN;
        newH = newW * info.realHeight / info.realWidth;
      } else {
        newH = IMG_VIEW_MIN;
        newW = newH * info.realWidth / info.realHeight;
      }
      info.curWidth = newW;
      info.curHeight = newH;
      return;
    }

    info.left += offset.offsetX * (1 - multiplier);
    info.top += offset.offsetY * (1 - multiplier);
    info.curWidth = newW;
    info.curHeight = newH;
  }

  private applyTransform(imgView: HTMLImageElement) {
    const info = this.imgInfo;
    imgView.style.width = `${info.curWidth}px`;
    imgView.style.height = `${info.curHeight}px`;
    imgView.style.transform = `translate(${info.left}px, ${info.top}px)`;
  }

  private srcToVaultPath(src: string): string {
    let path = src;
    try {
      const url = new URL(src);
      const decodedPath = decodeURIComponent(url.pathname);
      const vaultBasePath = this.app.vault.adapter instanceof FileSystemAdapter
        ? this.app.vault.adapter.getBasePath()
        : null;
      if (vaultBasePath && decodedPath.includes(vaultBasePath)) {
        const idx = decodedPath.indexOf(vaultBasePath);
        path = decodedPath.substring(idx + vaultBasePath.length);
        if (path.startsWith('/')) path = path.substring(1);
      } else {
        path = decodedPath;
        if (path.startsWith('/')) path = path.substring(1);
      }
    } catch {
      // not a valid URL — use as-is
    }
    return path;
  }

  private copyImagePath(src: string): void {
    const path = this.srcToVaultPath(src);
    navigator.clipboard.writeText(path).then(
      () => new Notice('Path copied: ' + path),
      () => new Notice('Failed to copy path')
    );
  }

  private async downloadImage(src: string): Promise<void> {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const path = this.srcToVaultPath(src);
      const filename = path.split('/').pop() || 'image';
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the download has time to start
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      new Notice('Downloaded: ' + filename);
    } catch (err) {
      console.error(err);
      new Notice('Failed to download');
    }
  }

  private copyImageToClipboard(imgView: HTMLImageElement): void {
    const image = new Image();
    const isFileUrl = imgView.src.startsWith('file:');
    if (!isFileUrl) {
      image.crossOrigin = 'anonymous';
    }
    image.src = imgView.src;
    image.onload = () => {
      const canvas = document.createElement('canvas');
      let w = image.naturalWidth;
      let h = image.naturalHeight;
      if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
        const scale = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
        w = Math.floor(w * scale);
        h = Math.floor(h * scale);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, w, h);
      try {
        canvas.toBlob(async (blob) => {
          canvas.width = 0;
          if (!blob) {
            new Notice('Failed to copy image');
            return;
          }
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            new Notice('Image copied');
          } catch {
            new Notice('Failed to copy image');
          }
        });
      } catch (err) {
        new Notice('Failed to copy image');
        console.error(err);
      }
    };
    image.onerror = () => {
      new Notice('Failed to copy image');
    };
  }

  private closeOverlay() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.overlayAbortController) {
      this.overlayAbortController.abort();
      this.overlayAbortController = null;
    }
    if (this.overlayScope) {
      this.app.keymap.popScope(this.overlayScope);
      this.overlayScope = null;
    }
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  // ---- Rich copy (markdown selection → text/plain + text/html with embedded images) ----

  private async writeRichClipboard(markdown: string): Promise<void> {
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
    const html = await this.markdownToHtmlWithEmbeddedImages(markdown, sourcePath);

    try {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([markdown], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
      ]);
    } catch (err) {
      console.error('Rich clipboard write failed', err);
      try {
        await navigator.clipboard.writeText(markdown);
      } catch {
        new Notice('Failed to copy');
      }
    }
  }

  private async markdownToHtmlWithEmbeddedImages(markdown: string, sourcePath: string): Promise<string> {
    // Collect all image refs first, resolve to data URLs in parallel
    const refs: Array<{ raw: string; src: string; alt: string }> = [];
    const collect = (raw: string, src: string, alt: string) => {
      refs.push({ raw, src, alt });
    };

    // Pattern: ![[path|alt]] or ![[path]]
    markdown.replace(/!\[\[([^\]]+)\]\]/g, (raw, inner: string) => {
      const [linkpath, alt = ''] = inner.split('|');
      collect(raw, linkpath.trim(), alt.trim());
      return raw;
    });
    // Pattern: ![alt](url)
    markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (raw, alt: string, src: string) => {
      collect(raw, src.trim(), alt);
      return raw;
    });

    const resolved = new Map<string, string>(); // raw → final src (data URL or original)
    await Promise.all(refs.map(async ({ raw, src, alt }) => {
      const finalSrc = await this.resolveImageSrc(src, sourcePath);
      resolved.set(raw, finalSrc ?? src);
    }));

    // Render: split into lines, replace image refs with <img>, escape rest
    const lines = markdown.split('\n');
    const htmlLines = lines.map((line) => {
      // Find all image-ref matches and rebuild line
      const parts: string[] = [];
      let cursor = 0;
      const combined = /!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = combined.exec(line)) !== null) {
        const before = line.slice(cursor, m.index);
        if (before) parts.push(escapeHtml(before));
        const raw = m[0];
        const alt = (m[2] ?? m[1]?.split('|')[1] ?? '').trim();
        const finalSrc = resolved.get(raw) ?? '';
        parts.push(`<img src="${escapeAttr(finalSrc)}" alt="${escapeAttr(alt)}">`);
        cursor = m.index + raw.length;
      }
      const rest = line.slice(cursor);
      if (rest) parts.push(escapeHtml(rest));
      return parts.join('');
    });

    return `<div>${htmlLines.join('<br>')}</div>`;
  }

  private async resolveImageSrc(src: string, sourcePath: string): Promise<string | null> {
    // Already inline / remote
    if (src.startsWith('data:')) return src;
    if (/^https?:\/\//i.test(src)) {
      const dataUrl = await fetchAsDataUrl(src);
      return dataUrl ?? src;
    }

    // Vault-resolved path
    const linkpath = decodeURIComponent(src).replace(/^\/+/, '');
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (!file || !(file instanceof TFile)) return null;

    try {
      const buf = await this.app.vault.adapter.readBinary(file.path);
      if (buf.byteLength > MAX_EMBED_BYTES) {
        new Notice(`Skipped embedding (too large): ${file.name}`);
        return null;
      }
      const ext = file.extension.toLowerCase();
      const mime = IMAGE_EXT_MIME[ext] ?? 'application/octet-stream';
      return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
    } catch (err) {
      console.error('Failed to read vault image', err);
      return null;
    }
  }
}

// ---- Helpers ----

function hasImageRef(text: string): boolean {
  return /!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/.test(text);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return btoa(binary);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > MAX_EMBED_BYTES) return null;
    const buf = await blob.arrayBuffer();
    const mime = blob.type || 'application/octet-stream';
    return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
  } catch {
    return null;
  }
}
