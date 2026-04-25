import { Editor, FileSystemAdapter, MarkdownRenderer, Notice, Plugin, Scope, TFile } from 'obsidian';

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

  private handlePaste = (evt: ClipboardEvent) => {
    const target = evt.target as HTMLElement | null;
    if (!target || !target.closest(`.workspace-leaf-content[data-type='markdown']`)) return;

    const data = evt.clipboardData;
    if (!data) return;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    if (!html || !text) return;

    // Only override when HTML carries data: image URLs (i.e. we — or a similar tool —
    // wrote a rich version). For ordinary HTML pastes, let Obsidian handle it normally.
    if (!/<img\b[^>]*\bsrc=["']data:image\//i.test(html)) return;

    evt.preventDefault();
    evt.stopPropagation();
    // Insert the plain-text (original markdown) version instead.
    document.execCommand('insertText', false, text);
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
    this.registerDomEvent(document, 'paste', this.handlePaste, true);

    this.addCommand({
      id: 'copy-as-html-with-images',
      name: 'Copy selection as HTML with embedded images',
      editorCallback: (editor: Editor) => {
        void this.copySelectionAsRichHtml(editor);
      },
    });
  }

  onunload() {
    this.closeOverlay();
  }

  private openOverlay(src: string) {
    if (this.overlayEl) return;

    const { overlay, imgView, copyBtn, downloadBtn, copyPathBtn } = this.buildOverlayDom(src);
    this.overlayEl = overlay;
    document.body.appendChild(overlay);
    this.fitImageWhenReady(imgView);

    const controller = new AbortController();
    this.overlayAbortController = controller;
    const { signal } = controller;

    this.attachOverlayMouseHandlers(overlay, imgView, signal);
    this.attachOverlayButtonHandlers({ copyBtn, downloadBtn, copyPathBtn, imgView, src, signal });
    this.registerOverlayKeymap(imgView, src);
  }

  private buildOverlayDom(src: string) {
    const overlay = document.createElement('div');
    overlay.addClass('image-workflow-overlay');

    const imgView = document.createElement('img');
    imgView.addClass('image-workflow-view');
    imgView.src = src;

    const btnGroup = document.createElement('div');
    btnGroup.addClass('image-workflow-btn-group');

    const make = (label: string) => {
      const btn = document.createElement('button');
      btn.addClass('image-workflow-btn');
      btn.textContent = label;
      btnGroup.appendChild(btn);
      return btn;
    };
    const copyBtn = make('Copy');
    const downloadBtn = make('Download');
    const copyPathBtn = make('Copy Path');

    overlay.appendChild(imgView);
    overlay.appendChild(btnGroup);
    return { overlay, imgView, copyBtn, downloadBtn, copyPathBtn };
  }

  private fitImageWhenReady(imgView: HTMLImageElement) {
    if (imgView.complete && imgView.naturalWidth > 0) {
      this.calculateFitSize(imgView);
    } else {
      imgView.onload = () => {
        if (!this.overlayEl) return;
        this.calculateFitSize(imgView);
      };
    }
  }

  private attachOverlayMouseHandlers(overlay: HTMLDivElement, imgView: HTMLImageElement, signal: AbortSignal) {
    imgView.addEventListener('dragstart', (e) => e.preventDefault(), { signal });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeOverlay();
    }, { signal });
    imgView.addEventListener('wheel', (e) => {
      e.preventDefault();
      const ratio = e.deltaY < 0 ? 0.1 : -0.1;
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
  }

  private attachOverlayButtonHandlers(opts: {
    copyBtn: HTMLButtonElement;
    downloadBtn: HTMLButtonElement;
    copyPathBtn: HTMLButtonElement;
    imgView: HTMLImageElement;
    src: string;
    signal: AbortSignal;
  }) {
    const { copyBtn, downloadBtn, copyPathBtn, imgView, src, signal } = opts;
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

  private registerOverlayKeymap(imgView: HTMLImageElement, src: string) {
    const scope = new Scope();
    scope.register(null, 'Escape', () => { this.closeOverlay(); return false; });
    scope.register(['Mod'], 'c', () => { this.copyImageToClipboard(imgView); return false; });
    scope.register(['Mod', 'Shift'], 'c', () => { this.copyImagePath(src); return false; });
    scope.register(['Mod'], 's', () => { this.downloadImage(src); return false; });
    this.overlayScope = scope;
    this.app.keymap.pushScope(scope);
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

  // ---- Command: Copy selection as HTML with embedded images (Obsidian-rendered) ----

  private async copySelectionAsRichHtml(editor: Editor): Promise<void> {
    const selection = editor.getSelection() || editor.getValue();
    if (!selection) {
      new Notice('Nothing selected');
      return;
    }
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';

    // Pass HTML as a Promise<Blob> so the browser preserves the user-gesture
    // window across our async work (rendering + Mermaid wait + SVG raster can
    // easily exceed 1s).
    const htmlPromise = this.renderSelectionToHtmlBlob(selection, sourcePath);
    const textBlob = new Blob([selection], { type: 'text/plain' });

    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': htmlPromise, 'text/plain': textBlob }),
      ]);
      new Notice('Copied as HTML with embedded images');
    } catch (err) {
      console.error('Clipboard write failed', err);
      try {
        await navigator.clipboard.writeText(selection);
        new Notice('Copy failed — wrote plain text instead');
      } catch {
        new Notice('Failed to copy');
      }
    }
  }

  private async renderSelectionToHtmlBlob(selection: string, sourcePath: string): Promise<Blob> {
    const container = document.createElement('div');
    // opacity:0 (not visibility:hidden) — Mermaid/MathJax post-processors skip
    // elements they consider "invisible". opacity:0 keeps them processable.
    container.classList.add('markdown-preview-view', 'markdown-rendered');
    container.style.cssText = 'position:fixed; top:0; left:0; width:800px; ' +
      'height:auto; opacity:0; pointer-events:none; z-index:-1; overflow:visible';
    document.body.appendChild(container);

    try {
      await MarkdownRenderer.render(this.app, selection, container, sourcePath, this);
      await waitForAsyncRenders(container);

      container.querySelectorAll('.copy-code-button, .frontmatter, .frontmatter-container, .edit-block-button').forEach((el) => el.remove());
      await convertSvgToImg(container);
      inlineStyleForExternalPaste(container);
      await embedRemoteImages(container);

      const html = `<div>${container.innerHTML}</div>`;
      return new Blob([html], { type: 'text/html' });
    } finally {
      container.remove();
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
      new Notice(`Could not embed image: ${file.name}`);
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

const CALLOUT_COLORS: Record<string, { border: string; bg: string; title: string }> = {
  note:     { border: '#448aff', bg: '#e3f2fd', title: '#1565c0' },
  abstract: { border: '#00bcd4', bg: '#e0f7fa', title: '#00838f' },
  summary:  { border: '#00bcd4', bg: '#e0f7fa', title: '#00838f' },
  tldr:     { border: '#00bcd4', bg: '#e0f7fa', title: '#00838f' },
  info:     { border: '#00b8d4', bg: '#e1f5fe', title: '#0277bd' },
  todo:     { border: '#00b0ff', bg: '#e1f5fe', title: '#0277bd' },
  tip:      { border: '#00bfa5', bg: '#e0f2f1', title: '#00695c' },
  hint:     { border: '#00bfa5', bg: '#e0f2f1', title: '#00695c' },
  important:{ border: '#00bfa5', bg: '#e0f2f1', title: '#00695c' },
  success:  { border: '#00c853', bg: '#e8f5e9', title: '#2e7d32' },
  check:    { border: '#00c853', bg: '#e8f5e9', title: '#2e7d32' },
  done:     { border: '#00c853', bg: '#e8f5e9', title: '#2e7d32' },
  question: { border: '#64dd17', bg: '#f1f8e9', title: '#558b2f' },
  help:     { border: '#64dd17', bg: '#f1f8e9', title: '#558b2f' },
  faq:      { border: '#64dd17', bg: '#f1f8e9', title: '#558b2f' },
  warning:  { border: '#ff9100', bg: '#fff3e0', title: '#e65100' },
  caution:  { border: '#ff9100', bg: '#fff3e0', title: '#e65100' },
  attention:{ border: '#ff9100', bg: '#fff3e0', title: '#e65100' },
  failure:  { border: '#ff5252', bg: '#ffebee', title: '#c62828' },
  fail:     { border: '#ff5252', bg: '#ffebee', title: '#c62828' },
  missing:  { border: '#ff5252', bg: '#ffebee', title: '#c62828' },
  danger:   { border: '#ff1744', bg: '#ffebee', title: '#b71c1c' },
  error:    { border: '#ff1744', bg: '#ffebee', title: '#b71c1c' },
  bug:      { border: '#f50057', bg: '#fce4ec', title: '#ad1457' },
  example:  { border: '#7c4dff', bg: '#ede7f6', title: '#4527a0' },
  quote:    { border: '#9e9e9e', bg: '#fafafa', title: '#424242' },
  cite:     { border: '#9e9e9e', bg: '#fafafa', title: '#424242' },
};

function setStyle(el: HTMLElement, css: string): void {
  const existing = el.getAttribute('style') ?? '';
  el.setAttribute('style', existing ? `${existing}; ${css}` : css);
}

function inlineStyleForExternalPaste(root: HTMLElement): void {
  styleCodeBlocks(root);
  styleInlineCode(root);
  styleLists(root);
  styleFootnotes(root);
  styleHighlights(root);
  styleBlockquotes(root);
  styleCallouts(root);
  styleTables(root);
  styleHorizontalRules(root);
  styleHeadings(root);
  replaceTaskCheckboxes(root);
}

// Code blocks: flatten to a single-cell <table> with plain text, since Docs is
// unreliable with <pre>/<code> + syntax-highlight <span>s.
function styleCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll('pre').forEach((pre) => {
    const codeEl = pre.querySelector('code');
    const raw = ((codeEl ?? pre) as HTMLElement).innerText
      || (codeEl ?? pre).textContent
      || '';
    const text = raw.replace(/^\n+|\n+$/g, '');

    const table = document.createElement('table');
    table.setAttribute('style',
      'border-collapse:collapse; margin:8px 0; width:100%; ' +
      'background:#f6f8fa; border:1px solid #e1e4e8; border-radius:6px'
    );
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.setAttribute('style',
      'padding:12px 16px; ' +
      'font-family:Menlo, Consolas, "Courier New", monospace; ' +
      'font-size:13px; line-height:1.45; color:#24292e; ' +
      'white-space:pre-wrap; word-break:break-word; ' +
      'border:1px solid #e1e4e8'
    );
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const span = document.createElement('span');
      span.textContent = line.replace(/\t/g, '    ');
      td.appendChild(span);
      if (i < lines.length - 1) td.appendChild(document.createElement('br'));
    });
    tr.appendChild(td);
    table.appendChild(tr);
    pre.replaceWith(table);
  });
}

// Inline code: Docs strips <code>, so wrap in <span>.
function styleInlineCode(root: HTMLElement): void {
  root.querySelectorAll('code').forEach((code) => {
    if (code.closest('pre')) return;
    const span = document.createElement('span');
    span.innerHTML = code.innerHTML;
    span.setAttribute('style',
      'background:#f6f8fa; padding:2px 6px; border-radius:4px; ' +
      'font-family:Menlo, Consolas, "Courier New", monospace; font-size:0.9em; color:#d6336c'
    );
    code.replaceWith(span);
  });
}

function styleLists(root: HTMLElement): void {
  root.querySelectorAll('ul, ol').forEach((list) => {
    setStyle(list as HTMLElement, 'margin:4px 0; padding-left:28px');
  });
  root.querySelectorAll('ul ul, ol ol, ul ol, ol ul').forEach((list) => {
    setStyle(list as HTMLElement, 'margin:2px 0; padding-left:28px');
  });
  root.querySelectorAll('li').forEach((li) => {
    setStyle(li as HTMLElement, 'margin:2px 0');
  });
}

function styleFootnotes(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('section.footnotes, .footnotes').forEach((sec) => {
    setStyle(sec, 'margin-top:24px; padding-top:12px; border-top:1px solid #d0d7de; font-size:0.9em; color:#586069');
  });
  root.querySelectorAll<HTMLElement>('sup, .footnote-ref').forEach((sup) => {
    setStyle(sup, 'font-size:0.75em; vertical-align:super; line-height:0');
  });
}

function styleHighlights(root: HTMLElement): void {
  root.querySelectorAll('mark').forEach((mk) => {
    setStyle(mk as HTMLElement, 'background:#fff59d; padding:0 2px');
  });
}

function styleBlockquotes(root: HTMLElement): void {
  root.querySelectorAll('blockquote').forEach((bq) => {
    if ((bq as HTMLElement).classList.contains('callout')) return;
    setStyle(bq as HTMLElement,
      'border-left:4px solid #dfe2e5; margin:8px 0; padding:4px 12px; ' +
      'color:#586069; background:#fafbfc'
    );
  });
}

function styleCallouts(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.callout').forEach((co) => {
    const type = (co.getAttribute('data-callout') || 'note').toLowerCase();
    const colors = CALLOUT_COLORS[type] ?? CALLOUT_COLORS.note;
    setStyle(co,
      `border-left:4px solid ${colors.border}; background:${colors.bg}; ` +
      `border-radius:4px; padding:10px 14px; margin:8px 0; color:#24292e`
    );
    co.querySelectorAll<HTMLElement>('.callout-title').forEach((t) => {
      setStyle(t, `color:${colors.title}; font-weight:600; margin-bottom:4px; display:block`);
    });
    co.querySelectorAll<HTMLElement>('.callout-icon, .callout-fold').forEach((el) => el.remove());
  });
}

function styleTables(root: HTMLElement): void {
  root.querySelectorAll('table').forEach((tbl) => {
    setStyle(tbl as HTMLElement,
      'border-collapse:collapse; margin:8px 0; border:1px solid #d0d7de'
    );
  });
  root.querySelectorAll('th, td').forEach((cell) => {
    setStyle(cell as HTMLElement, 'border:1px solid #d0d7de; padding:6px 12px');
  });
  root.querySelectorAll('th').forEach((th) => {
    setStyle(th as HTMLElement, 'background:#f6f8fa; font-weight:600');
  });
}

function styleHorizontalRules(root: HTMLElement): void {
  root.querySelectorAll('hr').forEach((hr) => {
    setStyle(hr as HTMLElement, 'border:0; border-top:1px solid #d0d7de; margin:16px 0');
  });
}

const HEADING_SIZE: Record<string, string> = { H1: '1.8em', H2: '1.5em', H3: '1.25em', H4: '1.1em', H5: '1em', H6: '0.9em' };

function styleHeadings(root: HTMLElement): void {
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const size = HEADING_SIZE[h.tagName] ?? '1em';
    setStyle(h as HTMLElement, `font-weight:700; margin:0.6em 0 0.3em; font-size:${size}`);
  });
}

function replaceTaskCheckboxes(root: HTMLElement): void {
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    const span = document.createElement('span');
    span.textContent = cb.checked ? '☑ ' : '☐ ';
    setStyle(span, 'font-family:monospace');
    cb.replaceWith(span);
  });
}

async function waitForAsyncRenders(container: HTMLElement): Promise<void> {
  // Try to trigger Mermaid manually if the global is available and unrendered
  // mermaid blocks remain. Obsidian bundles mermaid; calling its run() is the
  // most reliable way to force render off-screen.
  await tryRunMermaid(container);

  // Poll for Mermaid / MathJax / similar async renderers up to ~3s total.
  // We consider the DOM "settled" when no unrendered placeholder remains AND
  // two consecutive samples see the same SVG / mjx-container count.
  const deadline = Date.now() + 3000;
  let lastCount = -1;
  let stableTicks = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 120));
    const pendingMermaid = container.querySelector('code.language-mermaid, pre.language-mermaid, .mermaid:not([data-processed])');
    const pendingMath = container.querySelector('.math:not(.is-loaded), code.language-math');
    const count = container.querySelectorAll('svg, mjx-container').length;
    if (!pendingMermaid && !pendingMath) {
      if (count === lastCount) {
        stableTicks++;
        if (stableTicks >= 2) return;
      } else {
        stableTicks = 0;
      }
    }
    lastCount = count;
    // Re-attempt Mermaid in case more code blocks appeared
    if (pendingMermaid) await tryRunMermaid(container);
  }
}

async function tryRunMermaid(container: HTMLElement): Promise<void> {
  // Mermaid is exposed on window in Obsidian. Try common APIs.
  const w = window as unknown as { mermaid?: { run?: (opts?: { nodes?: NodeListOf<Element> | Element[] }) => Promise<unknown>; init?: (config?: unknown, nodes?: NodeListOf<Element> | string) => void } };
  const mermaid = w.mermaid;
  if (!mermaid) return;

  // Find unrendered mermaid blocks. Obsidian usually wraps with <pre class="language-mermaid"><code>...</code></pre>
  const codeBlocks = Array.from(container.querySelectorAll<HTMLElement>('code.language-mermaid, pre.language-mermaid'));
  if (codeBlocks.length === 0) return;

  // Convert each block to a <div class="mermaid">code</div> that mermaid.run can consume
  for (const block of codeBlocks) {
    const code = block.tagName === 'PRE' ? block.querySelector('code')?.textContent ?? block.textContent ?? '' : block.textContent ?? '';
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid';
    wrapper.textContent = code;
    const target = block.tagName === 'PRE' ? block : block.parentElement || block;
    target.replaceWith(wrapper);
  }

  try {
    if (typeof mermaid.run === 'function') {
      await mermaid.run({ nodes: container.querySelectorAll('.mermaid') });
    } else if (typeof mermaid.init === 'function') {
      mermaid.init(undefined, container.querySelectorAll('.mermaid'));
    }
  } catch (err) {
    console.error('Manual mermaid render failed', err);
    new Notice('Mermaid diagram could not be rendered for clipboard');
  }
}

async function convertSvgToImg(root: HTMLElement): Promise<void> {
  // MathJax produces <mjx-container><svg/></mjx-container>. Extract the inner svg
  // first so the wrapping <mjx-container> (which Docs strips entirely) goes away.
  root.querySelectorAll('mjx-container').forEach((mjx) => {
    const svg = mjx.querySelector('svg');
    if (svg) {
      const isInline = (mjx as HTMLElement).getAttribute('display') !== 'true';
      const wrapper = document.createElement(isInline ? 'span' : 'div');
      if (!isInline) wrapper.setAttribute('style', 'text-align:center; margin:8px 0');
      wrapper.appendChild(svg);
      mjx.replaceWith(wrapper);
    } else {
      mjx.remove();
    }
  });

  const svgs = Array.from(root.querySelectorAll<SVGSVGElement>('svg'));
  await Promise.all(svgs.map(async (svg) => {
    try {
      const png = await rasterizeSvg(svg);
      if (png) {
        svg.replaceWith(png);
      }
    } catch (err) {
      console.error('SVG rasterization failed', err);
    }
  }));
}

async function rasterizeSvg(svg: SVGSVGElement): Promise<HTMLImageElement | null> {
  // Ensure xmlns + concrete dimensions so the standalone SVG renders correctly.
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!svg.getAttribute('xmlns:xlink')) svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  const rect = svg.getBoundingClientRect();
  const viewBox = svg.getAttribute('viewBox')?.split(/\s+/).map(Number);
  const intrinsicW = viewBox && viewBox.length === 4 ? viewBox[2] : 0;
  const intrinsicH = viewBox && viewBox.length === 4 ? viewBox[3] : 0;
  const cssW = rect.width || parseFloat(svg.getAttribute('width') || '0') || intrinsicW || 600;
  const cssH = rect.height || parseFloat(svg.getAttribute('height') || '0') || intrinsicH || 400;

  if (!svg.getAttribute('width')) svg.setAttribute('width', String(cssW));
  if (!svg.getAttribute('height')) svg.setAttribute('height', String(cssH));

  const serialized = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const dpr = 2; // 2x for crisper paste in Docs / Gmail
    const png = await new Promise<HTMLImageElement | null>((resolve) => {
      const loader = new Image();
      loader.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(cssW * dpr));
          canvas.height = Math.max(1, Math.round(cssH * dpr));
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(loader, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          const img = document.createElement('img');
          img.src = dataUrl;
          img.width = Math.round(cssW);
          img.height = Math.round(cssH);
          img.alt = 'diagram';
          resolve(img);
        } catch (err) {
          console.error('canvas draw failed', err);
          resolve(null);
        }
      };
      loader.onerror = () => resolve(null);
      loader.src = url;
    });
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function embedRemoteImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    const dataUrl = await fetchAsDataUrl(src);
    if (dataUrl) {
      img.setAttribute('src', dataUrl);
      img.removeAttribute('srcset');
    }
  }));
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  // Only follow http(s). Refuse file://, app://, blob:, etc. — in Electron's
  // renderer fetch can read local files, which would let a crafted note
  // exfiltrate them via the clipboard payload.
  if (!/^https?:\/\//i.test(url)) return null;
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
