"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ImageEnlargePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var IMG_SELECTOR = `.workspace-leaf-content[data-type='markdown'] img:not(a img), .workspace-leaf-content[data-type='image'] img`;
var ZOOM_FACTOR = 0.8;
var IMG_VIEW_MIN = 30;
var BUTTON_AREA_HEIGHT = 100;
var MAX_CANVAS_DIM = 8192;
var MAX_EMBED_BYTES = 5 * 1024 * 1024;
var IMAGE_EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif"
};
var ImageEnlargePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.overlayEl = null;
    this.imgInfo = { curWidth: 0, curHeight: 0, realWidth: 0, realHeight: 0, left: 0, top: 0 };
    this.overlayScope = null;
    this.overlayAbortController = null;
    this.rafId = null;
    this.handleImageClick = (evt) => {
      const target = evt.target;
      const img = target instanceof HTMLImageElement ? target : target.closest("img");
      if (!img || !(img instanceof HTMLImageElement))
        return;
      if (!img.matches(IMG_SELECTOR))
        return;
      if (this.overlayEl)
        return;
      evt.preventDefault();
      evt.stopPropagation();
      this.openOverlay(img.src);
    };
    this.handlePaste = (evt) => {
      const target = evt.target;
      if (!target || !target.closest(`.workspace-leaf-content[data-type='markdown']`))
        return;
      const data = evt.clipboardData;
      if (!data)
        return;
      const html = data.getData("text/html");
      const text = data.getData("text/plain");
      if (!html || !text)
        return;
      if (!/<img\b[^>]*\bsrc=["']data:image\//i.test(html))
        return;
      evt.preventDefault();
      evt.stopPropagation();
      document.execCommand("insertText", false, text);
    };
    this.handleCopy = (evt) => {
      const target = evt.target;
      if (!target || !target.closest(`.workspace-leaf-content[data-type='markdown']`))
        return;
      const selection = window.getSelection();
      const text = selection == null ? void 0 : selection.toString();
      if (!text)
        return;
      if (!hasImageRef(text))
        return;
      evt.preventDefault();
      evt.stopPropagation();
      void this.writeRichClipboard(text);
    };
  }
  onload() {
    this.registerDomEvent(document, "click", this.handleImageClick, true);
    this.registerDomEvent(document, "copy", this.handleCopy, true);
    this.registerDomEvent(document, "paste", this.handlePaste, true);
    this.addCommand({
      id: "copy-as-html-with-images",
      name: "Copy selection as HTML with embedded images",
      editorCallback: (editor) => {
        void this.copySelectionAsRichHtml(editor);
      }
    });
  }
  onunload() {
    this.closeOverlay();
  }
  openOverlay(src) {
    if (this.overlayEl)
      return;
    const overlay = document.createElement("div");
    overlay.addClass("image-enlarge-overlay");
    this.overlayEl = overlay;
    const imgView = document.createElement("img");
    imgView.addClass("image-enlarge-view");
    imgView.src = src;
    const btnGroup = document.createElement("div");
    btnGroup.addClass("image-enlarge-btn-group");
    const copyBtn = document.createElement("button");
    copyBtn.addClass("image-enlarge-btn");
    copyBtn.textContent = "Copy";
    const downloadBtn = document.createElement("button");
    downloadBtn.addClass("image-enlarge-btn");
    downloadBtn.textContent = "Download";
    const copyPathBtn = document.createElement("button");
    copyPathBtn.addClass("image-enlarge-btn");
    copyPathBtn.textContent = "Copy Path";
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
        if (!this.overlayEl)
          return;
        this.calculateFitSize(imgView);
      };
    }
    const controller = new AbortController();
    this.overlayAbortController = controller;
    const { signal } = controller;
    imgView.addEventListener("dragstart", (e) => e.preventDefault(), { signal });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay)
        this.closeOverlay();
    }, { signal });
    this.overlayScope = new import_obsidian.Scope();
    this.overlayScope.register(null, "Escape", () => {
      this.closeOverlay();
      return false;
    });
    this.overlayScope.register(["Mod"], "c", () => {
      this.copyImageToClipboard(imgView);
      return false;
    });
    this.overlayScope.register(["Mod", "Shift"], "c", () => {
      this.copyImagePath(src);
      return false;
    });
    this.overlayScope.register(["Mod"], "s", () => {
      this.downloadImage(src);
      return false;
    });
    this.app.keymap.pushScope(this.overlayScope);
    imgView.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomIn = e.deltaY < 0;
      const ratio = zoomIn ? 0.1 : -0.1;
      const rect = imgView.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      if (this.rafId !== null)
        cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.zoom(ratio, { offsetX, offsetY });
        this.applyTransform(imgView);
      });
    }, { signal });
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.copyImageToClipboard(imgView);
    }, { signal });
    downloadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.downloadImage(src);
    }, { signal });
    copyPathBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.copyImagePath(src);
    }, { signal });
  }
  calculateFitSize(imgView) {
    const winW = document.documentElement.clientWidth;
    const winH = document.documentElement.clientHeight - BUTTON_AREA_HEIGHT;
    const zoomW = winW * ZOOM_FACTOR;
    const zoomH = winH * ZOOM_FACTOR;
    let w = imgView.naturalWidth, h = imgView.naturalHeight;
    if (h > zoomH) {
      h = zoomH;
      w = h / imgView.naturalHeight * imgView.naturalWidth;
      if (w > zoomW)
        w = zoomW;
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
      top: (winH - h) / 2
    };
    this.applyTransform(imgView);
  }
  zoom(ratio, offset) {
    const info = this.imgInfo;
    const zoomIn = ratio > 0;
    const multiplier = zoomIn ? 1 + ratio : 1 / (1 - ratio);
    let zoomRatio = info.curWidth * multiplier / info.realWidth;
    const curRatio = info.curWidth / info.realWidth;
    if (curRatio < 1 && zoomRatio > 1 || curRatio > 1 && zoomRatio < 1) {
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
  applyTransform(imgView) {
    const info = this.imgInfo;
    imgView.style.width = `${info.curWidth}px`;
    imgView.style.height = `${info.curHeight}px`;
    imgView.style.transform = `translate(${info.left}px, ${info.top}px)`;
  }
  srcToVaultPath(src) {
    let path = src;
    try {
      const url = new URL(src);
      const decodedPath = decodeURIComponent(url.pathname);
      const vaultBasePath = this.app.vault.adapter instanceof import_obsidian.FileSystemAdapter ? this.app.vault.adapter.getBasePath() : null;
      if (vaultBasePath && decodedPath.includes(vaultBasePath)) {
        const idx = decodedPath.indexOf(vaultBasePath);
        path = decodedPath.substring(idx + vaultBasePath.length);
        if (path.startsWith("/"))
          path = path.substring(1);
      } else {
        path = decodedPath;
        if (path.startsWith("/"))
          path = path.substring(1);
      }
    } catch (e) {
    }
    return path;
  }
  copyImagePath(src) {
    const path = this.srcToVaultPath(src);
    navigator.clipboard.writeText(path).then(
      () => new import_obsidian.Notice("Path copied: " + path),
      () => new import_obsidian.Notice("Failed to copy path")
    );
  }
  async downloadImage(src) {
    try {
      const res = await fetch(src);
      if (!res.ok)
        throw new Error("fetch failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const path = this.srcToVaultPath(src);
      const filename = path.split("/").pop() || "image";
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
      new import_obsidian.Notice("Downloaded: " + filename);
    } catch (err) {
      console.error(err);
      new import_obsidian.Notice("Failed to download");
    }
  }
  copyImageToClipboard(imgView) {
    const image = new Image();
    const isFileUrl = imgView.src.startsWith("file:");
    if (!isFileUrl) {
      image.crossOrigin = "anonymous";
    }
    image.src = imgView.src;
    image.onload = () => {
      const canvas = document.createElement("canvas");
      let w = image.naturalWidth;
      let h = image.naturalHeight;
      if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
        const scale = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
        w = Math.floor(w * scale);
        h = Math.floor(h * scale);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx)
        return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, w, h);
      try {
        canvas.toBlob(async (blob) => {
          canvas.width = 0;
          if (!blob) {
            new import_obsidian.Notice("Failed to copy image");
            return;
          }
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob })
            ]);
            new import_obsidian.Notice("Image copied");
          } catch (e) {
            new import_obsidian.Notice("Failed to copy image");
          }
        });
      } catch (err) {
        new import_obsidian.Notice("Failed to copy image");
        console.error(err);
      }
    };
    image.onerror = () => {
      new import_obsidian.Notice("Failed to copy image");
    };
  }
  closeOverlay() {
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
  async copySelectionAsRichHtml(editor) {
    var _a, _b;
    const selection = editor.getSelection() || editor.getValue();
    if (!selection) {
      new import_obsidian.Notice("Nothing selected");
      return;
    }
    const sourcePath = (_b = (_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) != null ? _b : "";
    const container = document.createElement("div");
    try {
      await import_obsidian.MarkdownRenderer.render(this.app, selection, container, sourcePath, this);
    } catch (err) {
      console.error("MarkdownRenderer failed", err);
      new import_obsidian.Notice("Failed to render markdown");
      return;
    }
    container.querySelectorAll(".copy-code-button, .frontmatter, .frontmatter-container, .edit-block-button").forEach((el) => el.remove());
    const imgs = Array.from(container.querySelectorAll("img"));
    await Promise.all(imgs.map(async (img) => {
      var _a2;
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:"))
        return;
      const dataUrl = await fetchAsDataUrl(src);
      if (dataUrl) {
        img.setAttribute("src", dataUrl);
        img.removeAttribute("srcset");
      } else {
        new import_obsidian.Notice(`Could not embed image: ${(_a2 = src.split("/").pop()) != null ? _a2 : src}`);
      }
    }));
    const html = `<div>${container.innerHTML}</div>`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([selection], { type: "text/plain" })
        })
      ]);
      new import_obsidian.Notice("Copied as HTML with embedded images");
    } catch (err) {
      console.error("Clipboard write failed", err);
      new import_obsidian.Notice("Failed to copy");
    }
  }
  // ---- Rich copy (markdown selection → text/plain + text/html with embedded images) ----
  async writeRichClipboard(markdown) {
    var _a, _b;
    const sourcePath = (_b = (_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) != null ? _b : "";
    const html = await this.markdownToHtmlWithEmbeddedImages(markdown, sourcePath);
    try {
      const htmlBlob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([markdown], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob })
      ]);
    } catch (err) {
      console.error("Rich clipboard write failed", err);
      try {
        await navigator.clipboard.writeText(markdown);
      } catch (e) {
        new import_obsidian.Notice("Failed to copy");
      }
    }
  }
  async markdownToHtmlWithEmbeddedImages(markdown, sourcePath) {
    const refs = [];
    const collect = (raw, src, alt) => {
      refs.push({ raw, src, alt });
    };
    markdown.replace(/!\[\[([^\]]+)\]\]/g, (raw, inner) => {
      const [linkpath, alt = ""] = inner.split("|");
      collect(raw, linkpath.trim(), alt.trim());
      return raw;
    });
    markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (raw, alt, src) => {
      collect(raw, src.trim(), alt);
      return raw;
    });
    const resolved = /* @__PURE__ */ new Map();
    await Promise.all(refs.map(async ({ raw, src, alt }) => {
      const finalSrc = await this.resolveImageSrc(src, sourcePath);
      resolved.set(raw, finalSrc != null ? finalSrc : src);
    }));
    const lines = markdown.split("\n");
    const htmlLines = lines.map((line) => {
      var _a, _b, _c, _d;
      const parts = [];
      let cursor = 0;
      const combined = /!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\(([^)]+)\)/g;
      let m;
      while ((m = combined.exec(line)) !== null) {
        const before = line.slice(cursor, m.index);
        if (before)
          parts.push(escapeHtml(before));
        const raw = m[0];
        const alt = ((_c = (_b = m[2]) != null ? _b : (_a = m[1]) == null ? void 0 : _a.split("|")[1]) != null ? _c : "").trim();
        const finalSrc = (_d = resolved.get(raw)) != null ? _d : "";
        parts.push(`<img src="${escapeAttr(finalSrc)}" alt="${escapeAttr(alt)}">`);
        cursor = m.index + raw.length;
      }
      const rest = line.slice(cursor);
      if (rest)
        parts.push(escapeHtml(rest));
      return parts.join("");
    });
    return `<div>${htmlLines.join("<br>")}</div>`;
  }
  async resolveImageSrc(src, sourcePath) {
    var _a;
    if (src.startsWith("data:"))
      return src;
    if (/^https?:\/\//i.test(src)) {
      const dataUrl = await fetchAsDataUrl(src);
      return dataUrl != null ? dataUrl : src;
    }
    const linkpath = decodeURIComponent(src).replace(/^\/+/, "");
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (!file || !(file instanceof import_obsidian.TFile))
      return null;
    try {
      const buf = await this.app.vault.adapter.readBinary(file.path);
      if (buf.byteLength > MAX_EMBED_BYTES) {
        new import_obsidian.Notice(`Skipped embedding (too large): ${file.name}`);
        return null;
      }
      const ext = file.extension.toLowerCase();
      const mime = (_a = IMAGE_EXT_MIME[ext]) != null ? _a : "application/octet-stream";
      return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
    } catch (err) {
      console.error("Failed to read vault image", err);
      return null;
    }
  }
};
function hasImageRef(text) {
  return /!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/.test(text);
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 32768;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return btoa(binary);
}
async function fetchAsDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok)
      return null;
    const blob = await res.blob();
    if (blob.size > MAX_EMBED_BYTES)
      return null;
    const buf = await blob.arrayBuffer();
    const mime = blob.type || "application/octet-stream";
    return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
  } catch (e) {
    return null;
  }
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgRWRpdG9yLCBGaWxlU3lzdGVtQWRhcHRlciwgTWFya2Rvd25SZW5kZXJlciwgTm90aWNlLCBQbHVnaW4sIFNjb3BlLCBURmlsZSB9IGZyb20gJ29ic2lkaWFuJztcblxuY29uc3QgSU1HX1NFTEVDVE9SID0gYC53b3Jrc3BhY2UtbGVhZi1jb250ZW50W2RhdGEtdHlwZT0nbWFya2Rvd24nXSBpbWc6bm90KGEgaW1nKSwgLndvcmtzcGFjZS1sZWFmLWNvbnRlbnRbZGF0YS10eXBlPSdpbWFnZSddIGltZ2A7XG5jb25zdCBaT09NX0ZBQ1RPUiA9IDAuODtcbmNvbnN0IElNR19WSUVXX01JTiA9IDMwO1xuY29uc3QgQlVUVE9OX0FSRUFfSEVJR0hUID0gMTAwOyAvLyBib3R0b20gYnV0dG9uIGdyb3VwIGNsZWFyYW5jZVxuY29uc3QgTUFYX0NBTlZBU19ESU0gPSA4MTkyO1xuY29uc3QgTUFYX0VNQkVEX0JZVEVTID0gNSAqIDEwMjQgKiAxMDI0OyAvLyA1TUIgcGVyIGltYWdlXG5cbmNvbnN0IElNQUdFX0VYVF9NSU1FOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICBwbmc6ICdpbWFnZS9wbmcnLFxuICBqcGc6ICdpbWFnZS9qcGVnJyxcbiAganBlZzogJ2ltYWdlL2pwZWcnLFxuICBnaWY6ICdpbWFnZS9naWYnLFxuICB3ZWJwOiAnaW1hZ2Uvd2VicCcsXG4gIHN2ZzogJ2ltYWdlL3N2Zyt4bWwnLFxuICBibXA6ICdpbWFnZS9ibXAnLFxuICBhdmlmOiAnaW1hZ2UvYXZpZicsXG59O1xuXG5pbnRlcmZhY2UgSW1nSW5mbyB7XG4gIGN1cldpZHRoOiBudW1iZXI7XG4gIGN1ckhlaWdodDogbnVtYmVyO1xuICByZWFsV2lkdGg6IG51bWJlcjtcbiAgcmVhbEhlaWdodDogbnVtYmVyO1xuICBsZWZ0OiBudW1iZXI7XG4gIHRvcDogbnVtYmVyO1xufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbWFnZUVubGFyZ2VQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBwcml2YXRlIG92ZXJsYXlFbDogSFRNTERpdkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBpbWdJbmZvOiBJbWdJbmZvID0geyBjdXJXaWR0aDogMCwgY3VySGVpZ2h0OiAwLCByZWFsV2lkdGg6IDAsIHJlYWxIZWlnaHQ6IDAsIGxlZnQ6IDAsIHRvcDogMCB9O1xuICBwcml2YXRlIG92ZXJsYXlTY29wZTogU2NvcGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBvdmVybGF5QWJvcnRDb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByYWZJZDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG5cbiAgcHJpdmF0ZSBoYW5kbGVJbWFnZUNsaWNrID0gKGV2dDogTW91c2VFdmVudCkgPT4ge1xuICAgIGNvbnN0IHRhcmdldCA9IGV2dC50YXJnZXQgYXMgSFRNTEVsZW1lbnQ7XG4gICAgY29uc3QgaW1nID0gdGFyZ2V0IGluc3RhbmNlb2YgSFRNTEltYWdlRWxlbWVudFxuICAgICAgPyB0YXJnZXRcbiAgICAgIDogdGFyZ2V0LmNsb3Nlc3QoJ2ltZycpO1xuICAgIGlmICghaW1nIHx8ICEoaW1nIGluc3RhbmNlb2YgSFRNTEltYWdlRWxlbWVudCkpIHJldHVybjtcbiAgICBpZiAoIWltZy5tYXRjaGVzKElNR19TRUxFQ1RPUikpIHJldHVybjtcbiAgICBpZiAodGhpcy5vdmVybGF5RWwpIHJldHVybjtcbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7IC8vIE9ic2lkaWFuIFx1NTA3NFx1MzA2RVx1MzBDRlx1MzBGM1x1MzBDOVx1MzBFOVx1MzA0Q1x1NzUzQlx1NTBDRlx1MzA5Mlx1NTIyNVx1MzBEQVx1MzBBNFx1MzBGM1x1MzA2N1x1OTU4Qlx1MzA0Rlx1MzA2RVx1MzA5Mlx1OTYzMlx1MzA1MFxuICAgIHRoaXMub3Blbk92ZXJsYXkoaW1nLnNyYyk7XG4gIH07XG5cbiAgcHJpdmF0ZSBoYW5kbGVQYXN0ZSA9IChldnQ6IENsaXBib2FyZEV2ZW50KSA9PiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gZXZ0LnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgaWYgKCF0YXJnZXQgfHwgIXRhcmdldC5jbG9zZXN0KGAud29ya3NwYWNlLWxlYWYtY29udGVudFtkYXRhLXR5cGU9J21hcmtkb3duJ11gKSkgcmV0dXJuO1xuXG4gICAgY29uc3QgZGF0YSA9IGV2dC5jbGlwYm9hcmREYXRhO1xuICAgIGlmICghZGF0YSkgcmV0dXJuO1xuICAgIGNvbnN0IGh0bWwgPSBkYXRhLmdldERhdGEoJ3RleHQvaHRtbCcpO1xuICAgIGNvbnN0IHRleHQgPSBkYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKTtcbiAgICBpZiAoIWh0bWwgfHwgIXRleHQpIHJldHVybjtcblxuICAgIC8vIE9ubHkgb3ZlcnJpZGUgd2hlbiBIVE1MIGNhcnJpZXMgZGF0YTogaW1hZ2UgVVJMcyAoaS5lLiB3ZSBcdTIwMTQgb3IgYSBzaW1pbGFyIHRvb2wgXHUyMDE0XG4gICAgLy8gd3JvdGUgYSByaWNoIHZlcnNpb24pLiBGb3Igb3JkaW5hcnkgSFRNTCBwYXN0ZXMsIGxldCBPYnNpZGlhbiBoYW5kbGUgaXQgbm9ybWFsbHkuXG4gICAgaWYgKCEvPGltZ1xcYltePl0qXFxic3JjPVtcIiddZGF0YTppbWFnZVxcLy9pLnRlc3QoaHRtbCkpIHJldHVybjtcblxuICAgIGV2dC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGV2dC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAvLyBJbnNlcnQgdGhlIHBsYWluLXRleHQgKG9yaWdpbmFsIG1hcmtkb3duKSB2ZXJzaW9uIGluc3RlYWQuXG4gICAgZG9jdW1lbnQuZXhlY0NvbW1hbmQoJ2luc2VydFRleHQnLCBmYWxzZSwgdGV4dCk7XG4gIH07XG5cbiAgcHJpdmF0ZSBoYW5kbGVDb3B5ID0gKGV2dDogQ2xpcGJvYXJkRXZlbnQpID0+IHtcbiAgICBjb25zdCB0YXJnZXQgPSBldnQudGFyZ2V0IGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICAvLyBPbmx5IGludGVyY2VwdCBjb3BpZXMgb3JpZ2luYXRpbmcgZnJvbSBhIG1hcmtkb3duIGxlYWZcbiAgICBpZiAoIXRhcmdldCB8fCAhdGFyZ2V0LmNsb3Nlc3QoYC53b3Jrc3BhY2UtbGVhZi1jb250ZW50W2RhdGEtdHlwZT0nbWFya2Rvd24nXWApKSByZXR1cm47XG5cbiAgICBjb25zdCBzZWxlY3Rpb24gPSB3aW5kb3cuZ2V0U2VsZWN0aW9uKCk7XG4gICAgY29uc3QgdGV4dCA9IHNlbGVjdGlvbj8udG9TdHJpbmcoKTtcbiAgICBpZiAoIXRleHQpIHJldHVybjtcblxuICAgIGlmICghaGFzSW1hZ2VSZWYodGV4dCkpIHJldHVybjtcblxuICAgIC8vIFdlIHdpbGwgaGFuZGxlIHRoaXMgY29weTogcHJldmVudCBkZWZhdWx0IGFuZCB3cml0ZSBhc3luY2hyb25vdXNseS5cbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgdm9pZCB0aGlzLndyaXRlUmljaENsaXBib2FyZCh0ZXh0KTtcbiAgfTtcblxuICBvbmxvYWQoKSB7XG4gICAgLy8gY2FwdHVyZTogdHJ1ZSBcdTIwMTQgT2JzaWRpYW4vQ002IFx1MzA2RSBzdG9wUHJvcGFnYXRpb24gXHUzMDg4XHUzMDhBXHU1MTQ4XHUzMDZCXHU3NjdBXHU3MDZCXG4gICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KGRvY3VtZW50LCAnY2xpY2snLCB0aGlzLmhhbmRsZUltYWdlQ2xpY2ssIHRydWUpO1xuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgJ2NvcHknLCB0aGlzLmhhbmRsZUNvcHksIHRydWUpO1xuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgJ3Bhc3RlJywgdGhpcy5oYW5kbGVQYXN0ZSwgdHJ1ZSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdjb3B5LWFzLWh0bWwtd2l0aC1pbWFnZXMnLFxuICAgICAgbmFtZTogJ0NvcHkgc2VsZWN0aW9uIGFzIEhUTUwgd2l0aCBlbWJlZGRlZCBpbWFnZXMnLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IChlZGl0b3I6IEVkaXRvcikgPT4ge1xuICAgICAgICB2b2lkIHRoaXMuY29weVNlbGVjdGlvbkFzUmljaEh0bWwoZWRpdG9yKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICBvbnVubG9hZCgpIHtcbiAgICB0aGlzLmNsb3NlT3ZlcmxheSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBvcGVuT3ZlcmxheShzcmM6IHN0cmluZykge1xuICAgIGlmICh0aGlzLm92ZXJsYXlFbCkgcmV0dXJuO1xuXG4gICAgY29uc3Qgb3ZlcmxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIG92ZXJsYXkuYWRkQ2xhc3MoJ2ltYWdlLWVubGFyZ2Utb3ZlcmxheScpO1xuICAgIHRoaXMub3ZlcmxheUVsID0gb3ZlcmxheTtcblxuICAgIGNvbnN0IGltZ1ZpZXcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbWcnKTtcbiAgICBpbWdWaWV3LmFkZENsYXNzKCdpbWFnZS1lbmxhcmdlLXZpZXcnKTtcbiAgICBpbWdWaWV3LnNyYyA9IHNyYztcblxuICAgIGNvbnN0IGJ0bkdyb3VwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgYnRuR3JvdXAuYWRkQ2xhc3MoJ2ltYWdlLWVubGFyZ2UtYnRuLWdyb3VwJyk7XG5cbiAgICBjb25zdCBjb3B5QnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgY29weUJ0bi5hZGRDbGFzcygnaW1hZ2UtZW5sYXJnZS1idG4nKTtcbiAgICBjb3B5QnRuLnRleHRDb250ZW50ID0gJ0NvcHknO1xuXG4gICAgY29uc3QgZG93bmxvYWRCdG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICBkb3dubG9hZEJ0bi5hZGRDbGFzcygnaW1hZ2UtZW5sYXJnZS1idG4nKTtcbiAgICBkb3dubG9hZEJ0bi50ZXh0Q29udGVudCA9ICdEb3dubG9hZCc7XG5cbiAgICBjb25zdCBjb3B5UGF0aEJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICAgIGNvcHlQYXRoQnRuLmFkZENsYXNzKCdpbWFnZS1lbmxhcmdlLWJ0bicpO1xuICAgIGNvcHlQYXRoQnRuLnRleHRDb250ZW50ID0gJ0NvcHkgUGF0aCc7XG5cbiAgICBidG5Hcm91cC5hcHBlbmRDaGlsZChjb3B5QnRuKTtcbiAgICBidG5Hcm91cC5hcHBlbmRDaGlsZChkb3dubG9hZEJ0bik7XG4gICAgYnRuR3JvdXAuYXBwZW5kQ2hpbGQoY29weVBhdGhCdG4pO1xuICAgIG92ZXJsYXkuYXBwZW5kQ2hpbGQoaW1nVmlldyk7XG4gICAgb3ZlcmxheS5hcHBlbmRDaGlsZChidG5Hcm91cCk7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChvdmVybGF5KTtcblxuICAgIGlmIChpbWdWaWV3LmNvbXBsZXRlICYmIGltZ1ZpZXcubmF0dXJhbFdpZHRoID4gMCkge1xuICAgICAgdGhpcy5jYWxjdWxhdGVGaXRTaXplKGltZ1ZpZXcpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpbWdWaWV3Lm9ubG9hZCA9ICgpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLm92ZXJsYXlFbCkgcmV0dXJuO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZUZpdFNpemUoaW1nVmlldyk7XG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgdGhpcy5vdmVybGF5QWJvcnRDb250cm9sbGVyID0gY29udHJvbGxlcjtcbiAgICBjb25zdCB7IHNpZ25hbCB9ID0gY29udHJvbGxlcjtcblxuICAgIGltZ1ZpZXcuYWRkRXZlbnRMaXN0ZW5lcignZHJhZ3N0YXJ0JywgKGUpID0+IGUucHJldmVudERlZmF1bHQoKSwgeyBzaWduYWwgfSk7XG5cbiAgICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcbiAgICAgIGlmIChlLnRhcmdldCA9PT0gb3ZlcmxheSkgdGhpcy5jbG9zZU92ZXJsYXkoKTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcblxuICAgIHRoaXMub3ZlcmxheVNjb3BlID0gbmV3IFNjb3BlKCk7XG4gICAgdGhpcy5vdmVybGF5U2NvcGUucmVnaXN0ZXIobnVsbCwgJ0VzY2FwZScsICgpID0+IHtcbiAgICAgIHRoaXMuY2xvc2VPdmVybGF5KCk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSk7XG4gICAgdGhpcy5vdmVybGF5U2NvcGUucmVnaXN0ZXIoWydNb2QnXSwgJ2MnLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvcHlJbWFnZVRvQ2xpcGJvYXJkKGltZ1ZpZXcpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0pO1xuICAgIHRoaXMub3ZlcmxheVNjb3BlLnJlZ2lzdGVyKFsnTW9kJywgJ1NoaWZ0J10sICdjJywgKCkgPT4ge1xuICAgICAgdGhpcy5jb3B5SW1hZ2VQYXRoKHNyYyk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSk7XG4gICAgdGhpcy5vdmVybGF5U2NvcGUucmVnaXN0ZXIoWydNb2QnXSwgJ3MnLCAoKSA9PiB7XG4gICAgICB0aGlzLmRvd25sb2FkSW1hZ2Uoc3JjKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9KTtcbiAgICB0aGlzLmFwcC5rZXltYXAucHVzaFNjb3BlKHRoaXMub3ZlcmxheVNjb3BlKTtcblxuICAgIGltZ1ZpZXcuYWRkRXZlbnRMaXN0ZW5lcignd2hlZWwnLCAoZSkgPT4ge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgY29uc3Qgem9vbUluID0gZS5kZWx0YVkgPCAwO1xuICAgICAgY29uc3QgcmF0aW8gPSB6b29tSW4gPyAwLjEgOiAtMC4xO1xuICAgICAgY29uc3QgcmVjdCA9IGltZ1ZpZXcuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBjb25zdCBvZmZzZXRYID0gZS5jbGllbnRYIC0gcmVjdC5sZWZ0O1xuICAgICAgY29uc3Qgb2Zmc2V0WSA9IGUuY2xpZW50WSAtIHJlY3QudG9wO1xuICAgICAgaWYgKHRoaXMucmFmSWQgIT09IG51bGwpIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmFmSWQpO1xuICAgICAgdGhpcy5yYWZJZCA9IHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiB7XG4gICAgICAgIHRoaXMucmFmSWQgPSBudWxsO1xuICAgICAgICB0aGlzLnpvb20ocmF0aW8sIHsgb2Zmc2V0WCwgb2Zmc2V0WSB9KTtcbiAgICAgICAgdGhpcy5hcHBseVRyYW5zZm9ybShpbWdWaWV3KTtcbiAgICAgIH0pO1xuICAgIH0sIHsgc2lnbmFsIH0pO1xuXG4gICAgY29weUJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XG4gICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5jb3B5SW1hZ2VUb0NsaXBib2FyZChpbWdWaWV3KTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcblxuICAgIGRvd25sb2FkQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcbiAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLmRvd25sb2FkSW1hZ2Uoc3JjKTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcblxuICAgIGNvcHlQYXRoQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcbiAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLmNvcHlJbWFnZVBhdGgoc3JjKTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY2FsY3VsYXRlRml0U2l6ZShpbWdWaWV3OiBIVE1MSW1hZ2VFbGVtZW50KSB7XG4gICAgY29uc3Qgd2luVyA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5jbGllbnRXaWR0aDtcbiAgICBjb25zdCB3aW5IID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudEhlaWdodCAtIEJVVFRPTl9BUkVBX0hFSUdIVDtcbiAgICBjb25zdCB6b29tVyA9IHdpblcgKiBaT09NX0ZBQ1RPUjtcbiAgICBjb25zdCB6b29tSCA9IHdpbkggKiBaT09NX0ZBQ1RPUjtcblxuICAgIGxldCB3ID0gaW1nVmlldy5uYXR1cmFsV2lkdGgsIGggPSBpbWdWaWV3Lm5hdHVyYWxIZWlnaHQ7XG4gICAgaWYgKGggPiB6b29tSCkge1xuICAgICAgaCA9IHpvb21IO1xuICAgICAgdyA9IGggLyBpbWdWaWV3Lm5hdHVyYWxIZWlnaHQgKiBpbWdWaWV3Lm5hdHVyYWxXaWR0aDtcbiAgICAgIGlmICh3ID4gem9vbVcpIHcgPSB6b29tVztcbiAgICB9IGVsc2UgaWYgKHcgPiB6b29tVykge1xuICAgICAgdyA9IHpvb21XO1xuICAgIH1cbiAgICBoID0gdyAqIGltZ1ZpZXcubmF0dXJhbEhlaWdodCAvIGltZ1ZpZXcubmF0dXJhbFdpZHRoO1xuXG4gICAgdGhpcy5pbWdJbmZvID0ge1xuICAgICAgY3VyV2lkdGg6IHcsXG4gICAgICBjdXJIZWlnaHQ6IGgsXG4gICAgICByZWFsV2lkdGg6IGltZ1ZpZXcubmF0dXJhbFdpZHRoLFxuICAgICAgcmVhbEhlaWdodDogaW1nVmlldy5uYXR1cmFsSGVpZ2h0LFxuICAgICAgbGVmdDogKHdpblcgLSB3KSAvIDIsXG4gICAgICB0b3A6ICh3aW5IIC0gaCkgLyAyLFxuICAgIH07XG4gICAgdGhpcy5hcHBseVRyYW5zZm9ybShpbWdWaWV3KTtcbiAgfVxuXG4gIHByaXZhdGUgem9vbShyYXRpbzogbnVtYmVyLCBvZmZzZXQ6IHsgb2Zmc2V0WDogbnVtYmVyOyBvZmZzZXRZOiBudW1iZXIgfSkge1xuICAgIGNvbnN0IGluZm8gPSB0aGlzLmltZ0luZm87XG4gICAgY29uc3Qgem9vbUluID0gcmF0aW8gPiAwO1xuICAgIGNvbnN0IG11bHRpcGxpZXIgPSB6b29tSW4gPyAxICsgcmF0aW8gOiAxIC8gKDEgLSByYXRpbyk7XG4gICAgbGV0IHpvb21SYXRpbyA9IGluZm8uY3VyV2lkdGggKiBtdWx0aXBsaWVyIC8gaW5mby5yZWFsV2lkdGg7XG5cbiAgICBjb25zdCBjdXJSYXRpbyA9IGluZm8uY3VyV2lkdGggLyBpbmZvLnJlYWxXaWR0aDtcbiAgICBpZiAoKGN1clJhdGlvIDwgMSAmJiB6b29tUmF0aW8gPiAxKSB8fCAoY3VyUmF0aW8gPiAxICYmIHpvb21SYXRpbyA8IDEpKSB7XG4gICAgICB6b29tUmF0aW8gPSAxO1xuICAgICAgY29uc3Qgc25hcE11bHRpcGxpZXIgPSAxIC8gY3VyUmF0aW87XG4gICAgICBpbmZvLmxlZnQgKz0gb2Zmc2V0Lm9mZnNldFggKiAoMSAtIHNuYXBNdWx0aXBsaWVyKTtcbiAgICAgIGluZm8udG9wICs9IG9mZnNldC5vZmZzZXRZICogKDEgLSBzbmFwTXVsdGlwbGllcik7XG4gICAgICBpbmZvLmN1cldpZHRoID0gaW5mby5yZWFsV2lkdGg7XG4gICAgICBpbmZvLmN1ckhlaWdodCA9IGluZm8ucmVhbEhlaWdodDtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsZXQgbmV3VyA9IGluZm8ucmVhbFdpZHRoICogem9vbVJhdGlvO1xuICAgIGxldCBuZXdIID0gaW5mby5yZWFsSGVpZ2h0ICogem9vbVJhdGlvO1xuXG4gICAgaWYgKG5ld1cgPCBJTUdfVklFV19NSU4gfHwgbmV3SCA8IElNR19WSUVXX01JTikge1xuICAgICAgaWYgKG5ld1cgPCBJTUdfVklFV19NSU4pIHtcbiAgICAgICAgbmV3VyA9IElNR19WSUVXX01JTjtcbiAgICAgICAgbmV3SCA9IG5ld1cgKiBpbmZvLnJlYWxIZWlnaHQgLyBpbmZvLnJlYWxXaWR0aDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5ld0ggPSBJTUdfVklFV19NSU47XG4gICAgICAgIG5ld1cgPSBuZXdIICogaW5mby5yZWFsV2lkdGggLyBpbmZvLnJlYWxIZWlnaHQ7XG4gICAgICB9XG4gICAgICBpbmZvLmN1cldpZHRoID0gbmV3VztcbiAgICAgIGluZm8uY3VySGVpZ2h0ID0gbmV3SDtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpbmZvLmxlZnQgKz0gb2Zmc2V0Lm9mZnNldFggKiAoMSAtIG11bHRpcGxpZXIpO1xuICAgIGluZm8udG9wICs9IG9mZnNldC5vZmZzZXRZICogKDEgLSBtdWx0aXBsaWVyKTtcbiAgICBpbmZvLmN1cldpZHRoID0gbmV3VztcbiAgICBpbmZvLmN1ckhlaWdodCA9IG5ld0g7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5VHJhbnNmb3JtKGltZ1ZpZXc6IEhUTUxJbWFnZUVsZW1lbnQpIHtcbiAgICBjb25zdCBpbmZvID0gdGhpcy5pbWdJbmZvO1xuICAgIGltZ1ZpZXcuc3R5bGUud2lkdGggPSBgJHtpbmZvLmN1cldpZHRofXB4YDtcbiAgICBpbWdWaWV3LnN0eWxlLmhlaWdodCA9IGAke2luZm8uY3VySGVpZ2h0fXB4YDtcbiAgICBpbWdWaWV3LnN0eWxlLnRyYW5zZm9ybSA9IGB0cmFuc2xhdGUoJHtpbmZvLmxlZnR9cHgsICR7aW5mby50b3B9cHgpYDtcbiAgfVxuXG4gIHByaXZhdGUgc3JjVG9WYXVsdFBhdGgoc3JjOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGxldCBwYXRoID0gc3JjO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHNyYyk7XG4gICAgICBjb25zdCBkZWNvZGVkUGF0aCA9IGRlY29kZVVSSUNvbXBvbmVudCh1cmwucGF0aG5hbWUpO1xuICAgICAgY29uc3QgdmF1bHRCYXNlUGF0aCA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgaW5zdGFuY2VvZiBGaWxlU3lzdGVtQWRhcHRlclxuICAgICAgICA/IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZ2V0QmFzZVBhdGgoKVxuICAgICAgICA6IG51bGw7XG4gICAgICBpZiAodmF1bHRCYXNlUGF0aCAmJiBkZWNvZGVkUGF0aC5pbmNsdWRlcyh2YXVsdEJhc2VQYXRoKSkge1xuICAgICAgICBjb25zdCBpZHggPSBkZWNvZGVkUGF0aC5pbmRleE9mKHZhdWx0QmFzZVBhdGgpO1xuICAgICAgICBwYXRoID0gZGVjb2RlZFBhdGguc3Vic3RyaW5nKGlkeCArIHZhdWx0QmFzZVBhdGgubGVuZ3RoKTtcbiAgICAgICAgaWYgKHBhdGguc3RhcnRzV2l0aCgnLycpKSBwYXRoID0gcGF0aC5zdWJzdHJpbmcoMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXRoID0gZGVjb2RlZFBhdGg7XG4gICAgICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoJy8nKSkgcGF0aCA9IHBhdGguc3Vic3RyaW5nKDEpO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gbm90IGEgdmFsaWQgVVJMIFx1MjAxNCB1c2UgYXMtaXNcbiAgICB9XG4gICAgcmV0dXJuIHBhdGg7XG4gIH1cblxuICBwcml2YXRlIGNvcHlJbWFnZVBhdGgoc3JjOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBwYXRoID0gdGhpcy5zcmNUb1ZhdWx0UGF0aChzcmMpO1xuICAgIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHBhdGgpLnRoZW4oXG4gICAgICAoKSA9PiBuZXcgTm90aWNlKCdQYXRoIGNvcGllZDogJyArIHBhdGgpLFxuICAgICAgKCkgPT4gbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHkgcGF0aCcpXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZG93bmxvYWRJbWFnZShzcmM6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChzcmMpO1xuICAgICAgaWYgKCFyZXMub2spIHRocm93IG5ldyBFcnJvcignZmV0Y2ggZmFpbGVkJyk7XG4gICAgICBjb25zdCBibG9iID0gYXdhaXQgcmVzLmJsb2IoKTtcbiAgICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgICBjb25zdCBwYXRoID0gdGhpcy5zcmNUb1ZhdWx0UGF0aChzcmMpO1xuICAgICAgY29uc3QgZmlsZW5hbWUgPSBwYXRoLnNwbGl0KCcvJykucG9wKCkgfHwgJ2ltYWdlJztcbiAgICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgICBhLmhyZWYgPSB1cmw7XG4gICAgICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XG4gICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgICAgYS5jbGljaygpO1xuICAgICAgYS5yZW1vdmUoKTtcbiAgICAgIC8vIFJldm9rZSBhZnRlciBhIHRpY2sgc28gdGhlIGRvd25sb2FkIGhhcyB0aW1lIHRvIHN0YXJ0XG4gICAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgMTAwMCk7XG4gICAgICBuZXcgTm90aWNlKCdEb3dubG9hZGVkOiAnICsgZmlsZW5hbWUpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcihlcnIpO1xuICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGRvd25sb2FkJyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjb3B5SW1hZ2VUb0NsaXBib2FyZChpbWdWaWV3OiBIVE1MSW1hZ2VFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgaW1hZ2UgPSBuZXcgSW1hZ2UoKTtcbiAgICBjb25zdCBpc0ZpbGVVcmwgPSBpbWdWaWV3LnNyYy5zdGFydHNXaXRoKCdmaWxlOicpO1xuICAgIGlmICghaXNGaWxlVXJsKSB7XG4gICAgICBpbWFnZS5jcm9zc09yaWdpbiA9ICdhbm9ueW1vdXMnO1xuICAgIH1cbiAgICBpbWFnZS5zcmMgPSBpbWdWaWV3LnNyYztcbiAgICBpbWFnZS5vbmxvYWQgPSAoKSA9PiB7XG4gICAgICBjb25zdCBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICAgIGxldCB3ID0gaW1hZ2UubmF0dXJhbFdpZHRoO1xuICAgICAgbGV0IGggPSBpbWFnZS5uYXR1cmFsSGVpZ2h0O1xuICAgICAgaWYgKHcgPiBNQVhfQ0FOVkFTX0RJTSB8fCBoID4gTUFYX0NBTlZBU19ESU0pIHtcbiAgICAgICAgY29uc3Qgc2NhbGUgPSBNYXRoLm1pbihNQVhfQ0FOVkFTX0RJTSAvIHcsIE1BWF9DQU5WQVNfRElNIC8gaCk7XG4gICAgICAgIHcgPSBNYXRoLmZsb29yKHcgKiBzY2FsZSk7XG4gICAgICAgIGggPSBNYXRoLmZsb29yKGggKiBzY2FsZSk7XG4gICAgICB9XG4gICAgICBjYW52YXMud2lkdGggPSB3O1xuICAgICAgY2FudmFzLmhlaWdodCA9IGg7XG4gICAgICBjb25zdCBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICAgIGlmICghY3R4KSByZXR1cm47XG4gICAgICBjdHguZmlsbFN0eWxlID0gJyNmZmYnO1xuICAgICAgY3R4LmZpbGxSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7XG4gICAgICBjdHguZHJhd0ltYWdlKGltYWdlLCAwLCAwLCB3LCBoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNhbnZhcy50b0Jsb2IoYXN5bmMgKGJsb2IpID0+IHtcbiAgICAgICAgICBjYW52YXMud2lkdGggPSAwO1xuICAgICAgICAgIGlmICghYmxvYikge1xuICAgICAgICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHkgaW1hZ2UnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGUoW1xuICAgICAgICAgICAgICBuZXcgQ2xpcGJvYXJkSXRlbSh7ICdpbWFnZS9wbmcnOiBibG9iIH0pLFxuICAgICAgICAgICAgXSk7XG4gICAgICAgICAgICBuZXcgTm90aWNlKCdJbWFnZSBjb3BpZWQnKTtcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoJ0ZhaWxlZCB0byBjb3B5IGltYWdlJyk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gY29weSBpbWFnZScpO1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICB9XG4gICAgfTtcbiAgICBpbWFnZS5vbmVycm9yID0gKCkgPT4ge1xuICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHkgaW1hZ2UnKTtcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjbG9zZU92ZXJsYXkoKSB7XG4gICAgaWYgKHRoaXMucmFmSWQgIT09IG51bGwpIHtcbiAgICAgIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmFmSWQpO1xuICAgICAgdGhpcy5yYWZJZCA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0aGlzLm92ZXJsYXlBYm9ydENvbnRyb2xsZXIpIHtcbiAgICAgIHRoaXMub3ZlcmxheUFib3J0Q29udHJvbGxlci5hYm9ydCgpO1xuICAgICAgdGhpcy5vdmVybGF5QWJvcnRDb250cm9sbGVyID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMub3ZlcmxheVNjb3BlKSB7XG4gICAgICB0aGlzLmFwcC5rZXltYXAucG9wU2NvcGUodGhpcy5vdmVybGF5U2NvcGUpO1xuICAgICAgdGhpcy5vdmVybGF5U2NvcGUgPSBudWxsO1xuICAgIH1cbiAgICBpZiAodGhpcy5vdmVybGF5RWwpIHtcbiAgICAgIHRoaXMub3ZlcmxheUVsLnJlbW92ZSgpO1xuICAgICAgdGhpcy5vdmVybGF5RWwgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gQ29tbWFuZDogQ29weSBzZWxlY3Rpb24gYXMgSFRNTCB3aXRoIGVtYmVkZGVkIGltYWdlcyAoT2JzaWRpYW4tcmVuZGVyZWQpIC0tLS1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlTZWxlY3Rpb25Bc1JpY2hIdG1sKGVkaXRvcjogRWRpdG9yKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc2VsZWN0aW9uID0gZWRpdG9yLmdldFNlbGVjdGlvbigpIHx8IGVkaXRvci5nZXRWYWx1ZSgpO1xuICAgIGlmICghc2VsZWN0aW9uKSB7XG4gICAgICBuZXcgTm90aWNlKCdOb3RoaW5nIHNlbGVjdGVkJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHNvdXJjZVBhdGggPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpPy5wYXRoID8/ICcnO1xuXG4gICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IE1hcmtkb3duUmVuZGVyZXIucmVuZGVyKHRoaXMuYXBwLCBzZWxlY3Rpb24sIGNvbnRhaW5lciwgc291cmNlUGF0aCwgdGhpcyk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdNYXJrZG93blJlbmRlcmVyIGZhaWxlZCcsIGVycik7XG4gICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gcmVuZGVyIG1hcmtkb3duJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gU3RyaXAgT2JzaWRpYW4taW50ZXJuYWwgVUkgZWxlbWVudHMgdGhhdCBzaG91bGRuJ3QgYmUgaW4gY2xpcGJvYXJkIEhUTUxcbiAgICBjb250YWluZXIucXVlcnlTZWxlY3RvckFsbCgnLmNvcHktY29kZS1idXR0b24sIC5mcm9udG1hdHRlciwgLmZyb250bWF0dGVyLWNvbnRhaW5lciwgLmVkaXQtYmxvY2stYnV0dG9uJykuZm9yRWFjaCgoZWwpID0+IGVsLnJlbW92ZSgpKTtcblxuICAgIGNvbnN0IGltZ3MgPSBBcnJheS5mcm9tKGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yQWxsKCdpbWcnKSk7XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoaW1ncy5tYXAoYXN5bmMgKGltZykgPT4ge1xuICAgICAgY29uc3Qgc3JjID0gaW1nLmdldEF0dHJpYnV0ZSgnc3JjJyk7XG4gICAgICBpZiAoIXNyYyB8fCBzcmMuc3RhcnRzV2l0aCgnZGF0YTonKSkgcmV0dXJuO1xuICAgICAgY29uc3QgZGF0YVVybCA9IGF3YWl0IGZldGNoQXNEYXRhVXJsKHNyYyk7XG4gICAgICBpZiAoZGF0YVVybCkge1xuICAgICAgICBpbWcuc2V0QXR0cmlidXRlKCdzcmMnLCBkYXRhVXJsKTtcbiAgICAgICAgaW1nLnJlbW92ZUF0dHJpYnV0ZSgnc3Jjc2V0Jyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXcgTm90aWNlKGBDb3VsZCBub3QgZW1iZWQgaW1hZ2U6ICR7c3JjLnNwbGl0KCcvJykucG9wKCkgPz8gc3JjfWApO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIGNvbnN0IGh0bWwgPSBgPGRpdj4ke2NvbnRhaW5lci5pbm5lckhUTUx9PC9kaXY+YDtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlKFtcbiAgICAgICAgbmV3IENsaXBib2FyZEl0ZW0oe1xuICAgICAgICAgICd0ZXh0L2h0bWwnOiBuZXcgQmxvYihbaHRtbF0sIHsgdHlwZTogJ3RleHQvaHRtbCcgfSksXG4gICAgICAgICAgJ3RleHQvcGxhaW4nOiBuZXcgQmxvYihbc2VsZWN0aW9uXSwgeyB0eXBlOiAndGV4dC9wbGFpbicgfSksXG4gICAgICAgIH0pLFxuICAgICAgXSk7XG4gICAgICBuZXcgTm90aWNlKCdDb3BpZWQgYXMgSFRNTCB3aXRoIGVtYmVkZGVkIGltYWdlcycpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcignQ2xpcGJvYXJkIHdyaXRlIGZhaWxlZCcsIGVycik7XG4gICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gY29weScpO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gUmljaCBjb3B5IChtYXJrZG93biBzZWxlY3Rpb24gXHUyMTkyIHRleHQvcGxhaW4gKyB0ZXh0L2h0bWwgd2l0aCBlbWJlZGRlZCBpbWFnZXMpIC0tLS1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlUmljaENsaXBib2FyZChtYXJrZG93bjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc291cmNlUGF0aCA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk/LnBhdGggPz8gJyc7XG4gICAgY29uc3QgaHRtbCA9IGF3YWl0IHRoaXMubWFya2Rvd25Ub0h0bWxXaXRoRW1iZWRkZWRJbWFnZXMobWFya2Rvd24sIHNvdXJjZVBhdGgpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGh0bWxCbG9iID0gbmV3IEJsb2IoW2h0bWxdLCB7IHR5cGU6ICd0ZXh0L2h0bWwnIH0pO1xuICAgICAgY29uc3QgdGV4dEJsb2IgPSBuZXcgQmxvYihbbWFya2Rvd25dLCB7IHR5cGU6ICd0ZXh0L3BsYWluJyB9KTtcbiAgICAgIGF3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGUoW1xuICAgICAgICBuZXcgQ2xpcGJvYXJkSXRlbSh7ICd0ZXh0L2h0bWwnOiBodG1sQmxvYiwgJ3RleHQvcGxhaW4nOiB0ZXh0QmxvYiB9KSxcbiAgICAgIF0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcignUmljaCBjbGlwYm9hcmQgd3JpdGUgZmFpbGVkJywgZXJyKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KG1hcmtkb3duKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gY29weScpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbWFya2Rvd25Ub0h0bWxXaXRoRW1iZWRkZWRJbWFnZXMobWFya2Rvd246IHN0cmluZywgc291cmNlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICAvLyBDb2xsZWN0IGFsbCBpbWFnZSByZWZzIGZpcnN0LCByZXNvbHZlIHRvIGRhdGEgVVJMcyBpbiBwYXJhbGxlbFxuICAgIGNvbnN0IHJlZnM6IEFycmF5PHsgcmF3OiBzdHJpbmc7IHNyYzogc3RyaW5nOyBhbHQ6IHN0cmluZyB9PiA9IFtdO1xuICAgIGNvbnN0IGNvbGxlY3QgPSAocmF3OiBzdHJpbmcsIHNyYzogc3RyaW5nLCBhbHQ6IHN0cmluZykgPT4ge1xuICAgICAgcmVmcy5wdXNoKHsgcmF3LCBzcmMsIGFsdCB9KTtcbiAgICB9O1xuXG4gICAgLy8gUGF0dGVybjogIVtbcGF0aHxhbHRdXSBvciAhW1twYXRoXV1cbiAgICBtYXJrZG93bi5yZXBsYWNlKC8hXFxbXFxbKFteXFxdXSspXFxdXFxdL2csIChyYXcsIGlubmVyOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IFtsaW5rcGF0aCwgYWx0ID0gJyddID0gaW5uZXIuc3BsaXQoJ3wnKTtcbiAgICAgIGNvbGxlY3QocmF3LCBsaW5rcGF0aC50cmltKCksIGFsdC50cmltKCkpO1xuICAgICAgcmV0dXJuIHJhdztcbiAgICB9KTtcbiAgICAvLyBQYXR0ZXJuOiAhW2FsdF0odXJsKVxuICAgIG1hcmtkb3duLnJlcGxhY2UoLyFcXFsoW15cXF1dKilcXF1cXCgoW14pXSspXFwpL2csIChyYXcsIGFsdDogc3RyaW5nLCBzcmM6IHN0cmluZykgPT4ge1xuICAgICAgY29sbGVjdChyYXcsIHNyYy50cmltKCksIGFsdCk7XG4gICAgICByZXR1cm4gcmF3O1xuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzb2x2ZWQgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpOyAvLyByYXcgXHUyMTkyIGZpbmFsIHNyYyAoZGF0YSBVUkwgb3Igb3JpZ2luYWwpXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwocmVmcy5tYXAoYXN5bmMgKHsgcmF3LCBzcmMsIGFsdCB9KSA9PiB7XG4gICAgICBjb25zdCBmaW5hbFNyYyA9IGF3YWl0IHRoaXMucmVzb2x2ZUltYWdlU3JjKHNyYywgc291cmNlUGF0aCk7XG4gICAgICByZXNvbHZlZC5zZXQocmF3LCBmaW5hbFNyYyA/PyBzcmMpO1xuICAgIH0pKTtcblxuICAgIC8vIFJlbmRlcjogc3BsaXQgaW50byBsaW5lcywgcmVwbGFjZSBpbWFnZSByZWZzIHdpdGggPGltZz4sIGVzY2FwZSByZXN0XG4gICAgY29uc3QgbGluZXMgPSBtYXJrZG93bi5zcGxpdCgnXFxuJyk7XG4gICAgY29uc3QgaHRtbExpbmVzID0gbGluZXMubWFwKChsaW5lKSA9PiB7XG4gICAgICAvLyBGaW5kIGFsbCBpbWFnZS1yZWYgbWF0Y2hlcyBhbmQgcmVidWlsZCBsaW5lXG4gICAgICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgICAgIGxldCBjdXJzb3IgPSAwO1xuICAgICAgY29uc3QgY29tYmluZWQgPSAvIVxcW1xcWyhbXlxcXV0rKVxcXVxcXXwhXFxbKFteXFxdXSopXFxdXFwoKFteKV0rKVxcKS9nO1xuICAgICAgbGV0IG06IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gICAgICB3aGlsZSAoKG0gPSBjb21iaW5lZC5leGVjKGxpbmUpKSAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCBiZWZvcmUgPSBsaW5lLnNsaWNlKGN1cnNvciwgbS5pbmRleCk7XG4gICAgICAgIGlmIChiZWZvcmUpIHBhcnRzLnB1c2goZXNjYXBlSHRtbChiZWZvcmUpKTtcbiAgICAgICAgY29uc3QgcmF3ID0gbVswXTtcbiAgICAgICAgY29uc3QgYWx0ID0gKG1bMl0gPz8gbVsxXT8uc3BsaXQoJ3wnKVsxXSA/PyAnJykudHJpbSgpO1xuICAgICAgICBjb25zdCBmaW5hbFNyYyA9IHJlc29sdmVkLmdldChyYXcpID8/ICcnO1xuICAgICAgICBwYXJ0cy5wdXNoKGA8aW1nIHNyYz1cIiR7ZXNjYXBlQXR0cihmaW5hbFNyYyl9XCIgYWx0PVwiJHtlc2NhcGVBdHRyKGFsdCl9XCI+YCk7XG4gICAgICAgIGN1cnNvciA9IG0uaW5kZXggKyByYXcubGVuZ3RoO1xuICAgICAgfVxuICAgICAgY29uc3QgcmVzdCA9IGxpbmUuc2xpY2UoY3Vyc29yKTtcbiAgICAgIGlmIChyZXN0KSBwYXJ0cy5wdXNoKGVzY2FwZUh0bWwocmVzdCkpO1xuICAgICAgcmV0dXJuIHBhcnRzLmpvaW4oJycpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGA8ZGl2PiR7aHRtbExpbmVzLmpvaW4oJzxicj4nKX08L2Rpdj5gO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXNvbHZlSW1hZ2VTcmMoc3JjOiBzdHJpbmcsIHNvdXJjZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIC8vIEFscmVhZHkgaW5saW5lIC8gcmVtb3RlXG4gICAgaWYgKHNyYy5zdGFydHNXaXRoKCdkYXRhOicpKSByZXR1cm4gc3JjO1xuICAgIGlmICgvXmh0dHBzPzpcXC9cXC8vaS50ZXN0KHNyYykpIHtcbiAgICAgIGNvbnN0IGRhdGFVcmwgPSBhd2FpdCBmZXRjaEFzRGF0YVVybChzcmMpO1xuICAgICAgcmV0dXJuIGRhdGFVcmwgPz8gc3JjO1xuICAgIH1cblxuICAgIC8vIFZhdWx0LXJlc29sdmVkIHBhdGhcbiAgICBjb25zdCBsaW5rcGF0aCA9IGRlY29kZVVSSUNvbXBvbmVudChzcmMpLnJlcGxhY2UoL15cXC8rLywgJycpO1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGxpbmtwYXRoLCBzb3VyY2VQYXRoKTtcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSByZXR1cm4gbnVsbDtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBidWYgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWRCaW5hcnkoZmlsZS5wYXRoKTtcbiAgICAgIGlmIChidWYuYnl0ZUxlbmd0aCA+IE1BWF9FTUJFRF9CWVRFUykge1xuICAgICAgICBuZXcgTm90aWNlKGBTa2lwcGVkIGVtYmVkZGluZyAodG9vIGxhcmdlKTogJHtmaWxlLm5hbWV9YCk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgICAgY29uc3QgZXh0ID0gZmlsZS5leHRlbnNpb24udG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IG1pbWUgPSBJTUFHRV9FWFRfTUlNRVtleHRdID8/ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nO1xuICAgICAgcmV0dXJuIGBkYXRhOiR7bWltZX07YmFzZTY0LCR7YXJyYXlCdWZmZXJUb0Jhc2U2NChidWYpfWA7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gcmVhZCB2YXVsdCBpbWFnZScsIGVycik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLSBIZWxwZXJzIC0tLS1cblxuZnVuY3Rpb24gaGFzSW1hZ2VSZWYodGV4dDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvIVxcW1xcW1teXFxdXStcXF1cXF18IVxcW1teXFxdXSpcXF1cXChbXildK1xcKS8udGVzdCh0ZXh0KTtcbn1cblxuZnVuY3Rpb24gZXNjYXBlSHRtbChzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc1xuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7Jyk7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUF0dHIoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKTtcbn1cblxuZnVuY3Rpb24gYXJyYXlCdWZmZXJUb0Jhc2U2NChidWY6IEFycmF5QnVmZmVyKTogc3RyaW5nIHtcbiAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShidWYpO1xuICBjb25zdCBDSFVOSyA9IDB4ODAwMDtcbiAgbGV0IGJpbmFyeSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSBDSFVOSykge1xuICAgIGNvbnN0IHN1YiA9IGJ5dGVzLnN1YmFycmF5KGksIGkgKyBDSFVOSyk7XG4gICAgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgQXJyYXkuZnJvbShzdWIpKTtcbiAgfVxuICByZXR1cm4gYnRvYShiaW5hcnkpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFzRGF0YVVybCh1cmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICB0cnkge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHVybCk7XG4gICAgaWYgKCFyZXMub2spIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGJsb2IgPSBhd2FpdCByZXMuYmxvYigpO1xuICAgIGlmIChibG9iLnNpemUgPiBNQVhfRU1CRURfQllURVMpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGJsb2IuYXJyYXlCdWZmZXIoKTtcbiAgICBjb25zdCBtaW1lID0gYmxvYi50eXBlIHx8ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nO1xuICAgIHJldHVybiBgZGF0YToke21pbWV9O2Jhc2U2NCwke2FycmF5QnVmZmVyVG9CYXNlNjQoYnVmKX1gO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsc0JBQTBGO0FBRTFGLElBQU0sZUFBZTtBQUNyQixJQUFNLGNBQWM7QUFDcEIsSUFBTSxlQUFlO0FBQ3JCLElBQU0scUJBQXFCO0FBQzNCLElBQU0saUJBQWlCO0FBQ3ZCLElB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
