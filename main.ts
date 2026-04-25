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

    const overlay = document.createElement('div');
    overlay.addClass('image-workflow-overlay');
    this.overlayEl = overlay;

    const imgView = document.createElement('img');
    imgView.addClass('image-workflow-view');
    imgView.src = src;

    const btnGroup = document.createElement('div');
    btnGroup.addClass('image-workflow-btn-group');

    const copyBtn = document.createElement('button');
    copyBtn.addClass('image-workflow-btn');
    copyBtn.textContent = 'Copy';

    const downloadBtn = document.createElement('button');
    downloadBtn.addClass('image-workflow-btn');
    downloadBtn.textContent = 'Download';

    const copyPathBtn = document.createElement('button');
    copyPathBtn.addClass('image-workflow-btn');
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

  // ---- Command: Copy selection as HTML with embedded images (Obsidian-rendered) ----

  private async copySelectionAsRichHtml(editor: Editor): Promise<void> {
    const selection = editor.getSelection() || editor.getValue();
    if (!selection) {
      new Notice('Nothing selected');
      return;
    }
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';

    const container = document.createElement('div');
    // The container must be in the DOM for Mermaid/MathJax post-processing to run.
    // Use visibility:hidden (not display:none / off-screen) so layout still happens —
    // some renderers measure boxes before drawing.
    container.style.cssText = 'position:fixed; top:0; left:0; width:800px; ' +
      'visibility:hidden; pointer-events:none; z-index:-1';
    document.body.appendChild(container);

    try {
      await MarkdownRenderer.render(this.app, selection, container, sourcePath, this);
      // Wait for async post-processors (Mermaid, MathJax, Dataview, etc.) to finish.
      await waitForAsyncRenders(container);
    } catch (err) {
      console.error('MarkdownRenderer failed', err);
      new Notice('Failed to render markdown');
      container.remove();
      return;
    }

    // Strip Obsidian-internal UI elements that shouldn't be in clipboard HTML
    container.querySelectorAll('.copy-code-button, .frontmatter, .frontmatter-container, .edit-block-button').forEach((el) => el.remove());

    // Convert <svg> (Mermaid diagrams, MathJax) into data-URL <img>.
    // Google Docs / Gmail strip <svg> on paste; <img> survives.
    convertSvgToImg(container);

    // Google Docs / Gmail strip CSS classes — apply inline styles for code, callouts,
    // highlights, blockquotes, tables so formatting survives the paste.
    inlineStyleForExternalPaste(container);

    const imgs = Array.from(container.querySelectorAll('img'));
    await Promise.all(imgs.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) return;
      const dataUrl = await fetchAsDataUrl(src);
      if (dataUrl) {
        img.setAttribute('src', dataUrl);
        img.removeAttribute('srcset');
      } else {
        new Notice(`Could not embed image: ${src.split('/').pop() ?? src}`);
      }
    }));

    const html = `<div>${container.innerHTML}</div>`;
    container.remove();

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([selection], { type: 'text/plain' }),
        }),
      ]);
      new Notice('Copied as HTML with embedded images');
    } catch (err) {
      console.error('Clipboard write failed', err);
      new Notice('Failed to copy');
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
  // Code blocks (pre > code)
  root.querySelectorAll('pre').forEach((pre) => {
    setStyle(pre as HTMLElement,
      'background:#f6f8fa; border:1px solid #e1e4e8; border-radius:6px; ' +
      'padding:12px 16px; margin:8px 0; ' +
      'font-family:Menlo, Consolas, "Courier New", monospace; font-size:13px; ' +
      'line-height:1.45; white-space:pre-wrap; overflow-x:auto; color:#24292e'
    );
  });
  // Inline code (not inside <pre>) — Google Docs strips <code>, so wrap in <span>
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

  // Lists — explicit padding so nested levels are visibly indented in Docs / Gmail
  root.querySelectorAll('ul, ol').forEach((list) => {
    setStyle(list as HTMLElement, 'margin:4px 0; padding-left:28px');
  });
  root.querySelectorAll('ul ul, ol ol, ul ol, ol ul').forEach((list) => {
    setStyle(list as HTMLElement, 'margin:2px 0; padding-left:28px');
  });
  root.querySelectorAll('li').forEach((li) => {
    setStyle(li as HTMLElement, 'margin:2px 0');
  });

  // Footnotes — Obsidian renders these into <section class="footnotes"> at the end
  root.querySelectorAll<HTMLElement>('section.footnotes, .footnotes').forEach((sec) => {
    setStyle(sec, 'margin-top:24px; padding-top:12px; border-top:1px solid #d0d7de; font-size:0.9em; color:#586069');
  });
  root.querySelectorAll<HTMLElement>('sup, .footnote-ref').forEach((sup) => {
    setStyle(sup, 'font-size:0.75em; vertical-align:super; line-height:0');
  });

  // Highlights (==text== → <mark>)
  root.querySelectorAll('mark').forEach((mk) => {
    setStyle(mk as HTMLElement, 'background:#fff59d; padding:0 2px');
  });

  // Blockquotes
  root.querySelectorAll('blockquote').forEach((bq) => {
    if ((bq as HTMLElement).classList.contains('callout')) return;
    setStyle(bq as HTMLElement,
      'border-left:4px solid #dfe2e5; margin:8px 0; padding:4px 12px; ' +
      'color:#586069; background:#fafbfc'
    );
  });

  // Callouts
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

  // Tables
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

  // Horizontal rule
  root.querySelectorAll('hr').forEach((hr) => {
    setStyle(hr as HTMLElement, 'border:0; border-top:1px solid #d0d7de; margin:16px 0');
  });

  // Headings — keep some hierarchy when classes are stripped
  const headingSize: Record<string, string> = { H1: '1.8em', H2: '1.5em', H3: '1.25em', H4: '1.1em', H5: '1em', H6: '0.9em' };
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const size = headingSize[h.tagName] ?? '1em';
    setStyle(h as HTMLElement, `font-weight:700; margin:0.6em 0 0.3em; font-size:${size}`);
  });

  // Task list checkboxes — replace with unicode so Docs renders something visible
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    const span = document.createElement('span');
    span.textContent = cb.checked ? '☑ ' : '☐ ';
    setStyle(span, 'font-family:monospace');
    cb.replaceWith(span);
  });
}

async function waitForAsyncRenders(container: HTMLElement): Promise<void> {
  // Poll for Mermaid / MathJax / similar async renderers up to ~2.5s total.
  // We consider the DOM "settled" when no unrendered placeholder remains AND
  // two consecutive samples see the same SVG / mjx-container count.
  const deadline = Date.now() + 2500;
  let lastCount = -1;
  let stableTicks = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    const pendingMermaid = container.querySelector('code.language-mermaid');
    const pendingMath = container.querySelector('.math, code.language-math');
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
  }
}

function convertSvgToImg(root: HTMLElement): void {
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
  for (const svg of svgs) {
    try {
      // Ensure xmlns is present for standalone serialization
      if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      // Capture rendered size so the <img> keeps the same footprint
      const rect = svg.getBoundingClientRect();
      const width = svg.getAttribute('width') ?? (rect.width > 0 ? `${Math.round(rect.width)}` : null);
      const height = svg.getAttribute('height') ?? (rect.height > 0 ? `${Math.round(rect.height)}` : null);

      const serialized = new XMLSerializer().serializeToString(svg);
      const utf8 = new TextEncoder().encode(serialized);
      const base64 = arrayBufferToBase64(utf8.buffer);
      const dataUrl = `data:image/svg+xml;base64,${base64}`;

      const img = document.createElement('img');
      img.setAttribute('src', dataUrl);
      if (width) img.setAttribute('width', width);
      if (height) img.setAttribute('height', height);
      img.setAttribute('alt', 'diagram');

      // Mermaid/MathJax often wrap the svg in a div — replace just the svg.
      svg.replaceWith(img);
    } catch (err) {
      console.error('SVG → img conversion failed', err);
    }
  }
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
