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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgRmlsZVN5c3RlbUFkYXB0ZXIsIE5vdGljZSwgUGx1Z2luLCBTY29wZSwgVEZpbGUgfSBmcm9tICdvYnNpZGlhbic7XG5cbmNvbnN0IElNR19TRUxFQ1RPUiA9IGAud29ya3NwYWNlLWxlYWYtY29udGVudFtkYXRhLXR5cGU9J21hcmtkb3duJ10gaW1nOm5vdChhIGltZyksIC53b3Jrc3BhY2UtbGVhZi1jb250ZW50W2RhdGEtdHlwZT0naW1hZ2UnXSBpbWdgO1xuY29uc3QgWk9PTV9GQUNUT1IgPSAwLjg7XG5jb25zdCBJTUdfVklFV19NSU4gPSAzMDtcbmNvbnN0IEJVVFRPTl9BUkVBX0hFSUdIVCA9IDEwMDsgLy8gYm90dG9tIGJ1dHRvbiBncm91cCBjbGVhcmFuY2VcbmNvbnN0IE1BWF9DQU5WQVNfRElNID0gODE5MjtcbmNvbnN0IE1BWF9FTUJFRF9CWVRFUyA9IDUgKiAxMDI0ICogMTAyNDsgLy8gNU1CIHBlciBpbWFnZVxuXG5jb25zdCBJTUFHRV9FWFRfTUlNRTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgcG5nOiAnaW1hZ2UvcG5nJyxcbiAganBnOiAnaW1hZ2UvanBlZycsXG4gIGpwZWc6ICdpbWFnZS9qcGVnJyxcbiAgZ2lmOiAnaW1hZ2UvZ2lmJyxcbiAgd2VicDogJ2ltYWdlL3dlYnAnLFxuICBzdmc6ICdpbWFnZS9zdmcreG1sJyxcbiAgYm1wOiAnaW1hZ2UvYm1wJyxcbiAgYXZpZjogJ2ltYWdlL2F2aWYnLFxufTtcblxuaW50ZXJmYWNlIEltZ0luZm8ge1xuICBjdXJXaWR0aDogbnVtYmVyO1xuICBjdXJIZWlnaHQ6IG51bWJlcjtcbiAgcmVhbFdpZHRoOiBudW1iZXI7XG4gIHJlYWxIZWlnaHQ6IG51bWJlcjtcbiAgbGVmdDogbnVtYmVyO1xuICB0b3A6IG51bWJlcjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgSW1hZ2VFbmxhcmdlUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgcHJpdmF0ZSBvdmVybGF5RWw6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaW1nSW5mbzogSW1nSW5mbyA9IHsgY3VyV2lkdGg6IDAsIGN1ckhlaWdodDogMCwgcmVhbFdpZHRoOiAwLCByZWFsSGVpZ2h0OiAwLCBsZWZ0OiAwLCB0b3A6IDAgfTtcbiAgcHJpdmF0ZSBvdmVybGF5U2NvcGU6IFNjb3BlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgb3ZlcmxheUFib3J0Q29udHJvbGxlcjogQWJvcnRDb250cm9sbGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmFmSWQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuXG4gIHByaXZhdGUgaGFuZGxlSW1hZ2VDbGljayA9IChldnQ6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBjb25zdCB0YXJnZXQgPSBldnQudGFyZ2V0IGFzIEhUTUxFbGVtZW50O1xuICAgIGNvbnN0IGltZyA9IHRhcmdldCBpbnN0YW5jZW9mIEhUTUxJbWFnZUVsZW1lbnRcbiAgICAgID8gdGFyZ2V0XG4gICAgICA6IHRhcmdldC5jbG9zZXN0KCdpbWcnKTtcbiAgICBpZiAoIWltZyB8fCAhKGltZyBpbnN0YW5jZW9mIEhUTUxJbWFnZUVsZW1lbnQpKSByZXR1cm47XG4gICAgaWYgKCFpbWcubWF0Y2hlcyhJTUdfU0VMRUNUT1IpKSByZXR1cm47XG4gICAgaWYgKHRoaXMub3ZlcmxheUVsKSByZXR1cm47XG4gICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpOyAvLyBPYnNpZGlhbiBcdTUwNzRcdTMwNkVcdTMwQ0ZcdTMwRjNcdTMwQzlcdTMwRTlcdTMwNENcdTc1M0JcdTUwQ0ZcdTMwOTJcdTUyMjVcdTMwREFcdTMwQTRcdTMwRjNcdTMwNjdcdTk1OEJcdTMwNEZcdTMwNkVcdTMwOTJcdTk2MzJcdTMwNTBcbiAgICB0aGlzLm9wZW5PdmVybGF5KGltZy5zcmMpO1xuICB9O1xuXG4gIHByaXZhdGUgaGFuZGxlUGFzdGUgPSAoZXZ0OiBDbGlwYm9hcmRFdmVudCkgPT4ge1xuICAgIGNvbnN0IHRhcmdldCA9IGV2dC50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgIGlmICghdGFyZ2V0IHx8ICF0YXJnZXQuY2xvc2VzdChgLndvcmtzcGFjZS1sZWFmLWNvbnRlbnRbZGF0YS10eXBlPSdtYXJrZG93biddYCkpIHJldHVybjtcblxuICAgIGNvbnN0IGRhdGEgPSBldnQuY2xpcGJvYXJkRGF0YTtcbiAgICBpZiAoIWRhdGEpIHJldHVybjtcbiAgICBjb25zdCBodG1sID0gZGF0YS5nZXREYXRhKCd0ZXh0L2h0bWwnKTtcbiAgICBjb25zdCB0ZXh0ID0gZGF0YS5nZXREYXRhKCd0ZXh0L3BsYWluJyk7XG4gICAgaWYgKCFodG1sIHx8ICF0ZXh0KSByZXR1cm47XG5cbiAgICAvLyBPbmx5IG92ZXJyaWRlIHdoZW4gSFRNTCBjYXJyaWVzIGRhdGE6IGltYWdlIFVSTHMgKGkuZS4gd2UgXHUyMDE0IG9yIGEgc2ltaWxhciB0b29sIFx1MjAxNFxuICAgIC8vIHdyb3RlIGEgcmljaCB2ZXJzaW9uKS4gRm9yIG9yZGluYXJ5IEhUTUwgcGFzdGVzLCBsZXQgT2JzaWRpYW4gaGFuZGxlIGl0IG5vcm1hbGx5LlxuICAgIGlmICghLzxpbWdcXGJbXj5dKlxcYnNyYz1bXCInXWRhdGE6aW1hZ2VcXC8vaS50ZXN0KGh0bWwpKSByZXR1cm47XG5cbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgLy8gSW5zZXJ0IHRoZSBwbGFpbi10ZXh0IChvcmlnaW5hbCBtYXJrZG93bikgdmVyc2lvbiBpbnN0ZWFkLlxuICAgIGRvY3VtZW50LmV4ZWNDb21tYW5kKCdpbnNlcnRUZXh0JywgZmFsc2UsIHRleHQpO1xuICB9O1xuXG4gIHByaXZhdGUgaGFuZGxlQ29weSA9IChldnQ6IENsaXBib2FyZEV2ZW50KSA9PiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gZXZ0LnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgLy8gT25seSBpbnRlcmNlcHQgY29waWVzIG9yaWdpbmF0aW5nIGZyb20gYSBtYXJrZG93biBsZWFmXG4gICAgaWYgKCF0YXJnZXQgfHwgIXRhcmdldC5jbG9zZXN0KGAud29ya3NwYWNlLWxlYWYtY29udGVudFtkYXRhLXR5cGU9J21hcmtkb3duJ11gKSkgcmV0dXJuO1xuXG4gICAgY29uc3Qgc2VsZWN0aW9uID0gd2luZG93LmdldFNlbGVjdGlvbigpO1xuICAgIGNvbnN0IHRleHQgPSBzZWxlY3Rpb24/LnRvU3RyaW5nKCk7XG4gICAgaWYgKCF0ZXh0KSByZXR1cm47XG5cbiAgICBpZiAoIWhhc0ltYWdlUmVmKHRleHQpKSByZXR1cm47XG5cbiAgICAvLyBXZSB3aWxsIGhhbmRsZSB0aGlzIGNvcHk6IHByZXZlbnQgZGVmYXVsdCBhbmQgd3JpdGUgYXN5bmNocm9ub3VzbHkuXG4gICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIHZvaWQgdGhpcy53cml0ZVJpY2hDbGlwYm9hcmQodGV4dCk7XG4gIH07XG5cbiAgb25sb2FkKCkge1xuICAgIC8vIGNhcHR1cmU6IHRydWUgXHUyMDE0IE9ic2lkaWFuL0NNNiBcdTMwNkUgc3RvcFByb3BhZ2F0aW9uIFx1MzA4OFx1MzA4QVx1NTE0OFx1MzA2Qlx1NzY3QVx1NzA2QlxuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgJ2NsaWNrJywgdGhpcy5oYW5kbGVJbWFnZUNsaWNrLCB0cnVlKTtcbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQoZG9jdW1lbnQsICdjb3B5JywgdGhpcy5oYW5kbGVDb3B5LCB0cnVlKTtcbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQoZG9jdW1lbnQsICdwYXN0ZScsIHRoaXMuaGFuZGxlUGFzdGUsIHRydWUpO1xuICB9XG5cbiAgb251bmxvYWQoKSB7XG4gICAgdGhpcy5jbG9zZU92ZXJsYXkoKTtcbiAgfVxuXG4gIHByaXZhdGUgb3Blbk92ZXJsYXkoc3JjOiBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5vdmVybGF5RWwpIHJldHVybjtcblxuICAgIGNvbnN0IG92ZXJsYXkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBvdmVybGF5LmFkZENsYXNzKCdpbWFnZS1lbmxhcmdlLW92ZXJsYXknKTtcbiAgICB0aGlzLm92ZXJsYXlFbCA9IG92ZXJsYXk7XG5cbiAgICBjb25zdCBpbWdWaWV3ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW1nJyk7XG4gICAgaW1nVmlldy5hZGRDbGFzcygnaW1hZ2UtZW5sYXJnZS12aWV3Jyk7XG4gICAgaW1nVmlldy5zcmMgPSBzcmM7XG5cbiAgICBjb25zdCBidG5Hcm91cCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIGJ0bkdyb3VwLmFkZENsYXNzKCdpbWFnZS1lbmxhcmdlLWJ0bi1ncm91cCcpO1xuXG4gICAgY29uc3QgY29weUJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICAgIGNvcHlCdG4uYWRkQ2xhc3MoJ2ltYWdlLWVubGFyZ2UtYnRuJyk7XG4gICAgY29weUJ0bi50ZXh0Q29udGVudCA9ICdDb3B5JztcblxuICAgIGNvbnN0IGRvd25sb2FkQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgZG93bmxvYWRCdG4uYWRkQ2xhc3MoJ2ltYWdlLWVubGFyZ2UtYnRuJyk7XG4gICAgZG93bmxvYWRCdG4udGV4dENvbnRlbnQgPSAnRG93bmxvYWQnO1xuXG4gICAgY29uc3QgY29weVBhdGhCdG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICBjb3B5UGF0aEJ0bi5hZGRDbGFzcygnaW1hZ2UtZW5sYXJnZS1idG4nKTtcbiAgICBjb3B5UGF0aEJ0bi50ZXh0Q29udGVudCA9ICdDb3B5IFBhdGgnO1xuXG4gICAgYnRuR3JvdXAuYXBwZW5kQ2hpbGQoY29weUJ0bik7XG4gICAgYnRuR3JvdXAuYXBwZW5kQ2hpbGQoZG93bmxvYWRCdG4pO1xuICAgIGJ0bkdyb3VwLmFwcGVuZENoaWxkKGNvcHlQYXRoQnRuKTtcbiAgICBvdmVybGF5LmFwcGVuZENoaWxkKGltZ1ZpZXcpO1xuICAgIG92ZXJsYXkuYXBwZW5kQ2hpbGQoYnRuR3JvdXApO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQob3ZlcmxheSk7XG5cbiAgICBpZiAoaW1nVmlldy5jb21wbGV0ZSAmJiBpbWdWaWV3Lm5hdHVyYWxXaWR0aCA+IDApIHtcbiAgICAgIHRoaXMuY2FsY3VsYXRlRml0U2l6ZShpbWdWaWV3KTtcbiAgICB9IGVsc2Uge1xuICAgICAgaW1nVmlldy5vbmxvYWQgPSAoKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5vdmVybGF5RWwpIHJldHVybjtcbiAgICAgICAgdGhpcy5jYWxjdWxhdGVGaXRTaXplKGltZ1ZpZXcpO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICAgIHRoaXMub3ZlcmxheUFib3J0Q29udHJvbGxlciA9IGNvbnRyb2xsZXI7XG4gICAgY29uc3QgeyBzaWduYWwgfSA9IGNvbnRyb2xsZXI7XG5cbiAgICBpbWdWaWV3LmFkZEV2ZW50TGlzdGVuZXIoJ2RyYWdzdGFydCcsIChlKSA9PiBlLnByZXZlbnREZWZhdWx0KCksIHsgc2lnbmFsIH0pO1xuXG4gICAgb3ZlcmxheS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XG4gICAgICBpZiAoZS50YXJnZXQgPT09IG92ZXJsYXkpIHRoaXMuY2xvc2VPdmVybGF5KCk7XG4gICAgfSwgeyBzaWduYWwgfSk7XG5cbiAgICB0aGlzLm92ZXJsYXlTY29wZSA9IG5ldyBTY29wZSgpO1xuICAgIHRoaXMub3ZlcmxheVNjb3BlLnJlZ2lzdGVyKG51bGwsICdFc2NhcGUnLCAoKSA9PiB7XG4gICAgICB0aGlzLmNsb3NlT3ZlcmxheSgpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0pO1xuICAgIHRoaXMub3ZlcmxheVNjb3BlLnJlZ2lzdGVyKFsnTW9kJ10sICdjJywgKCkgPT4ge1xuICAgICAgdGhpcy5jb3B5SW1hZ2VUb0NsaXBib2FyZChpbWdWaWV3KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9KTtcbiAgICB0aGlzLm92ZXJsYXlTY29wZS5yZWdpc3RlcihbJ01vZCcsICdTaGlmdCddLCAnYycsICgpID0+IHtcbiAgICAgIHRoaXMuY29weUltYWdlUGF0aChzcmMpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0pO1xuICAgIHRoaXMub3ZlcmxheVNjb3BlLnJlZ2lzdGVyKFsnTW9kJ10sICdzJywgKCkgPT4ge1xuICAgICAgdGhpcy5kb3dubG9hZEltYWdlKHNyYyk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSk7XG4gICAgdGhpcy5hcHAua2V5bWFwLnB1c2hTY29wZSh0aGlzLm92ZXJsYXlTY29wZSk7XG5cbiAgICBpbWdWaWV3LmFkZEV2ZW50TGlzdGVuZXIoJ3doZWVsJywgKGUpID0+IHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGNvbnN0IHpvb21JbiA9IGUuZGVsdGFZIDwgMDtcbiAgICAgIGNvbnN0IHJhdGlvID0gem9vbUluID8gMC4xIDogLTAuMTtcbiAgICAgIGNvbnN0IHJlY3QgPSBpbWdWaWV3LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgY29uc3Qgb2Zmc2V0WCA9IGUuY2xpZW50WCAtIHJlY3QubGVmdDtcbiAgICAgIGNvbnN0IG9mZnNldFkgPSBlLmNsaWVudFkgLSByZWN0LnRvcDtcbiAgICAgIGlmICh0aGlzLnJhZklkICE9PSBudWxsKSBjYW5jZWxBbmltYXRpb25GcmFtZSh0aGlzLnJhZklkKTtcbiAgICAgIHRoaXMucmFmSWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4ge1xuICAgICAgICB0aGlzLnJhZklkID0gbnVsbDtcbiAgICAgICAgdGhpcy56b29tKHJhdGlvLCB7IG9mZnNldFgsIG9mZnNldFkgfSk7XG4gICAgICAgIHRoaXMuYXBwbHlUcmFuc2Zvcm0oaW1nVmlldyk7XG4gICAgICB9KTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcblxuICAgIGNvcHlCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4ge1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMuY29weUltYWdlVG9DbGlwYm9hcmQoaW1nVmlldyk7XG4gICAgfSwgeyBzaWduYWwgfSk7XG5cbiAgICBkb3dubG9hZEJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XG4gICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5kb3dubG9hZEltYWdlKHNyYyk7XG4gICAgfSwgeyBzaWduYWwgfSk7XG5cbiAgICBjb3B5UGF0aEJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XG4gICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5jb3B5SW1hZ2VQYXRoKHNyYyk7XG4gICAgfSwgeyBzaWduYWwgfSk7XG4gIH1cblxuICBwcml2YXRlIGNhbGN1bGF0ZUZpdFNpemUoaW1nVmlldzogSFRNTEltYWdlRWxlbWVudCkge1xuICAgIGNvbnN0IHdpblcgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuY2xpZW50V2lkdGg7XG4gICAgY29uc3Qgd2luSCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5jbGllbnRIZWlnaHQgLSBCVVRUT05fQVJFQV9IRUlHSFQ7XG4gICAgY29uc3Qgem9vbVcgPSB3aW5XICogWk9PTV9GQUNUT1I7XG4gICAgY29uc3Qgem9vbUggPSB3aW5IICogWk9PTV9GQUNUT1I7XG5cbiAgICBsZXQgdyA9IGltZ1ZpZXcubmF0dXJhbFdpZHRoLCBoID0gaW1nVmlldy5uYXR1cmFsSGVpZ2h0O1xuICAgIGlmIChoID4gem9vbUgpIHtcbiAgICAgIGggPSB6b29tSDtcbiAgICAgIHcgPSBoIC8gaW1nVmlldy5uYXR1cmFsSGVpZ2h0ICogaW1nVmlldy5uYXR1cmFsV2lkdGg7XG4gICAgICBpZiAodyA+IHpvb21XKSB3ID0gem9vbVc7XG4gICAgfSBlbHNlIGlmICh3ID4gem9vbVcpIHtcbiAgICAgIHcgPSB6b29tVztcbiAgICB9XG4gICAgaCA9IHcgKiBpbWdWaWV3Lm5hdHVyYWxIZWlnaHQgLyBpbWdWaWV3Lm5hdHVyYWxXaWR0aDtcblxuICAgIHRoaXMuaW1nSW5mbyA9IHtcbiAgICAgIGN1cldpZHRoOiB3LFxuICAgICAgY3VySGVpZ2h0OiBoLFxuICAgICAgcmVhbFdpZHRoOiBpbWdWaWV3Lm5hdHVyYWxXaWR0aCxcbiAgICAgIHJlYWxIZWlnaHQ6IGltZ1ZpZXcubmF0dXJhbEhlaWdodCxcbiAgICAgIGxlZnQ6ICh3aW5XIC0gdykgLyAyLFxuICAgICAgdG9wOiAod2luSCAtIGgpIC8gMixcbiAgICB9O1xuICAgIHRoaXMuYXBwbHlUcmFuc2Zvcm0oaW1nVmlldyk7XG4gIH1cblxuICBwcml2YXRlIHpvb20ocmF0aW86IG51bWJlciwgb2Zmc2V0OiB7IG9mZnNldFg6IG51bWJlcjsgb2Zmc2V0WTogbnVtYmVyIH0pIHtcbiAgICBjb25zdCBpbmZvID0gdGhpcy5pbWdJbmZvO1xuICAgIGNvbnN0IHpvb21JbiA9IHJhdGlvID4gMDtcbiAgICBjb25zdCBtdWx0aXBsaWVyID0gem9vbUluID8gMSArIHJhdGlvIDogMSAvICgxIC0gcmF0aW8pO1xuICAgIGxldCB6b29tUmF0aW8gPSBpbmZvLmN1cldpZHRoICogbXVsdGlwbGllciAvIGluZm8ucmVhbFdpZHRoO1xuXG4gICAgY29uc3QgY3VyUmF0aW8gPSBpbmZvLmN1cldpZHRoIC8gaW5mby5yZWFsV2lkdGg7XG4gICAgaWYgKChjdXJSYXRpbyA8IDEgJiYgem9vbVJhdGlvID4gMSkgfHwgKGN1clJhdGlvID4gMSAmJiB6b29tUmF0aW8gPCAxKSkge1xuICAgICAgem9vbVJhdGlvID0gMTtcbiAgICAgIGNvbnN0IHNuYXBNdWx0aXBsaWVyID0gMSAvIGN1clJhdGlvO1xuICAgICAgaW5mby5sZWZ0ICs9IG9mZnNldC5vZmZzZXRYICogKDEgLSBzbmFwTXVsdGlwbGllcik7XG4gICAgICBpbmZvLnRvcCArPSBvZmZzZXQub2Zmc2V0WSAqICgxIC0gc25hcE11bHRpcGxpZXIpO1xuICAgICAgaW5mby5jdXJXaWR0aCA9IGluZm8ucmVhbFdpZHRoO1xuICAgICAgaW5mby5jdXJIZWlnaHQgPSBpbmZvLnJlYWxIZWlnaHQ7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGV0IG5ld1cgPSBpbmZvLnJlYWxXaWR0aCAqIHpvb21SYXRpbztcbiAgICBsZXQgbmV3SCA9IGluZm8ucmVhbEhlaWdodCAqIHpvb21SYXRpbztcblxuICAgIGlmIChuZXdXIDwgSU1HX1ZJRVdfTUlOIHx8IG5ld0ggPCBJTUdfVklFV19NSU4pIHtcbiAgICAgIGlmIChuZXdXIDwgSU1HX1ZJRVdfTUlOKSB7XG4gICAgICAgIG5ld1cgPSBJTUdfVklFV19NSU47XG4gICAgICAgIG5ld0ggPSBuZXdXICogaW5mby5yZWFsSGVpZ2h0IC8gaW5mby5yZWFsV2lkdGg7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXdIID0gSU1HX1ZJRVdfTUlOO1xuICAgICAgICBuZXdXID0gbmV3SCAqIGluZm8ucmVhbFdpZHRoIC8gaW5mby5yZWFsSGVpZ2h0O1xuICAgICAgfVxuICAgICAgaW5mby5jdXJXaWR0aCA9IG5ld1c7XG4gICAgICBpbmZvLmN1ckhlaWdodCA9IG5ld0g7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaW5mby5sZWZ0ICs9IG9mZnNldC5vZmZzZXRYICogKDEgLSBtdWx0aXBsaWVyKTtcbiAgICBpbmZvLnRvcCArPSBvZmZzZXQub2Zmc2V0WSAqICgxIC0gbXVsdGlwbGllcik7XG4gICAgaW5mby5jdXJXaWR0aCA9IG5ld1c7XG4gICAgaW5mby5jdXJIZWlnaHQgPSBuZXdIO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseVRyYW5zZm9ybShpbWdWaWV3OiBIVE1MSW1hZ2VFbGVtZW50KSB7XG4gICAgY29uc3QgaW5mbyA9IHRoaXMuaW1nSW5mbztcbiAgICBpbWdWaWV3LnN0eWxlLndpZHRoID0gYCR7aW5mby5jdXJXaWR0aH1weGA7XG4gICAgaW1nVmlldy5zdHlsZS5oZWlnaHQgPSBgJHtpbmZvLmN1ckhlaWdodH1weGA7XG4gICAgaW1nVmlldy5zdHlsZS50cmFuc2Zvcm0gPSBgdHJhbnNsYXRlKCR7aW5mby5sZWZ0fXB4LCAke2luZm8udG9wfXB4KWA7XG4gIH1cblxuICBwcml2YXRlIHNyY1RvVmF1bHRQYXRoKHNyYzogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBsZXQgcGF0aCA9IHNyYztcbiAgICB0cnkge1xuICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChzcmMpO1xuICAgICAgY29uc3QgZGVjb2RlZFBhdGggPSBkZWNvZGVVUklDb21wb25lbnQodXJsLnBhdGhuYW1lKTtcbiAgICAgIGNvbnN0IHZhdWx0QmFzZVBhdGggPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyIGluc3RhbmNlb2YgRmlsZVN5c3RlbUFkYXB0ZXJcbiAgICAgICAgPyB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmdldEJhc2VQYXRoKClcbiAgICAgICAgOiBudWxsO1xuICAgICAgaWYgKHZhdWx0QmFzZVBhdGggJiYgZGVjb2RlZFBhdGguaW5jbHVkZXModmF1bHRCYXNlUGF0aCkpIHtcbiAgICAgICAgY29uc3QgaWR4ID0gZGVjb2RlZFBhdGguaW5kZXhPZih2YXVsdEJhc2VQYXRoKTtcbiAgICAgICAgcGF0aCA9IGRlY29kZWRQYXRoLnN1YnN0cmluZyhpZHggKyB2YXVsdEJhc2VQYXRoLmxlbmd0aCk7XG4gICAgICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoJy8nKSkgcGF0aCA9IHBhdGguc3Vic3RyaW5nKDEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGF0aCA9IGRlY29kZWRQYXRoO1xuICAgICAgICBpZiAocGF0aC5zdGFydHNXaXRoKCcvJykpIHBhdGggPSBwYXRoLnN1YnN0cmluZygxKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIG5vdCBhIHZhbGlkIFVSTCBcdTIwMTQgdXNlIGFzLWlzXG4gICAgfVxuICAgIHJldHVybiBwYXRoO1xuICB9XG5cbiAgcHJpdmF0ZSBjb3B5SW1hZ2VQYXRoKHNyYzogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgcGF0aCA9IHRoaXMuc3JjVG9WYXVsdFBhdGgoc3JjKTtcbiAgICBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChwYXRoKS50aGVuKFxuICAgICAgKCkgPT4gbmV3IE5vdGljZSgnUGF0aCBjb3BpZWQ6ICcgKyBwYXRoKSxcbiAgICAgICgpID0+IG5ldyBOb3RpY2UoJ0ZhaWxlZCB0byBjb3B5IHBhdGgnKVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGRvd25sb2FkSW1hZ2Uoc3JjOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goc3JjKTtcbiAgICAgIGlmICghcmVzLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ2ZldGNoIGZhaWxlZCcpO1xuICAgICAgY29uc3QgYmxvYiA9IGF3YWl0IHJlcy5ibG9iKCk7XG4gICAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgICAgY29uc3QgcGF0aCA9IHRoaXMuc3JjVG9WYXVsdFBhdGgoc3JjKTtcbiAgICAgIGNvbnN0IGZpbGVuYW1lID0gcGF0aC5zcGxpdCgnLycpLnBvcCgpIHx8ICdpbWFnZSc7XG4gICAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xuICAgICAgYS5ocmVmID0gdXJsO1xuICAgICAgYS5kb3dubG9hZCA9IGZpbGVuYW1lO1xuICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChhKTtcbiAgICAgIGEuY2xpY2soKTtcbiAgICAgIGEucmVtb3ZlKCk7XG4gICAgICAvLyBSZXZva2UgYWZ0ZXIgYSB0aWNrIHNvIHRoZSBkb3dubG9hZCBoYXMgdGltZSB0byBzdGFydFxuICAgICAgc2V0VGltZW91dCgoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCksIDEwMDApO1xuICAgICAgbmV3IE5vdGljZSgnRG93bmxvYWRlZDogJyArIGZpbGVuYW1lKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcbiAgICAgIG5ldyBOb3RpY2UoJ0ZhaWxlZCB0byBkb3dubG9hZCcpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY29weUltYWdlVG9DbGlwYm9hcmQoaW1nVmlldzogSFRNTEltYWdlRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGltYWdlID0gbmV3IEltYWdlKCk7XG4gICAgY29uc3QgaXNGaWxlVXJsID0gaW1nVmlldy5zcmMuc3RhcnRzV2l0aCgnZmlsZTonKTtcbiAgICBpZiAoIWlzRmlsZVVybCkge1xuICAgICAgaW1hZ2UuY3Jvc3NPcmlnaW4gPSAnYW5vbnltb3VzJztcbiAgICB9XG4gICAgaW1hZ2Uuc3JjID0gaW1nVmlldy5zcmM7XG4gICAgaW1hZ2Uub25sb2FkID0gKCkgPT4ge1xuICAgICAgY29uc3QgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gICAgICBsZXQgdyA9IGltYWdlLm5hdHVyYWxXaWR0aDtcbiAgICAgIGxldCBoID0gaW1hZ2UubmF0dXJhbEhlaWdodDtcbiAgICAgIGlmICh3ID4gTUFYX0NBTlZBU19ESU0gfHwgaCA+IE1BWF9DQU5WQVNfRElNKSB7XG4gICAgICAgIGNvbnN0IHNjYWxlID0gTWF0aC5taW4oTUFYX0NBTlZBU19ESU0gLyB3LCBNQVhfQ0FOVkFTX0RJTSAvIGgpO1xuICAgICAgICB3ID0gTWF0aC5mbG9vcih3ICogc2NhbGUpO1xuICAgICAgICBoID0gTWF0aC5mbG9vcihoICogc2NhbGUpO1xuICAgICAgfVxuICAgICAgY2FudmFzLndpZHRoID0gdztcbiAgICAgIGNhbnZhcy5oZWlnaHQgPSBoO1xuICAgICAgY29uc3QgY3R4ID0gY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgICBpZiAoIWN0eCkgcmV0dXJuO1xuICAgICAgY3R4LmZpbGxTdHlsZSA9ICcjZmZmJztcbiAgICAgIGN0eC5maWxsUmVjdCgwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpO1xuICAgICAgY3R4LmRyYXdJbWFnZShpbWFnZSwgMCwgMCwgdywgaCk7XG4gICAgICB0cnkge1xuICAgICAgICBjYW52YXMudG9CbG9iKGFzeW5jIChibG9iKSA9PiB7XG4gICAgICAgICAgY2FudmFzLndpZHRoID0gMDtcbiAgICAgICAgICBpZiAoIWJsb2IpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoJ0ZhaWxlZCB0byBjb3B5IGltYWdlJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlKFtcbiAgICAgICAgICAgICAgbmV3IENsaXBib2FyZEl0ZW0oeyAnaW1hZ2UvcG5nJzogYmxvYiB9KSxcbiAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgbmV3IE5vdGljZSgnSW1hZ2UgY29waWVkJyk7XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gY29weSBpbWFnZScpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHkgaW1hZ2UnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnIpO1xuICAgICAgfVxuICAgIH07XG4gICAgaW1hZ2Uub25lcnJvciA9ICgpID0+IHtcbiAgICAgIG5ldyBOb3RpY2UoJ0ZhaWxlZCB0byBjb3B5IGltYWdlJyk7XG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY2xvc2VPdmVybGF5KCkge1xuICAgIGlmICh0aGlzLnJhZklkICE9PSBudWxsKSB7XG4gICAgICBjYW5jZWxBbmltYXRpb25GcmFtZSh0aGlzLnJhZklkKTtcbiAgICAgIHRoaXMucmFmSWQgPSBudWxsO1xuICAgIH1cbiAgICBpZiAodGhpcy5vdmVybGF5QWJvcnRDb250cm9sbGVyKSB7XG4gICAgICB0aGlzLm92ZXJsYXlBYm9ydENvbnRyb2xsZXIuYWJvcnQoKTtcbiAgICAgIHRoaXMub3ZlcmxheUFib3J0Q29udHJvbGxlciA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0aGlzLm92ZXJsYXlTY29wZSkge1xuICAgICAgdGhpcy5hcHAua2V5bWFwLnBvcFNjb3BlKHRoaXMub3ZlcmxheVNjb3BlKTtcbiAgICAgIHRoaXMub3ZlcmxheVNjb3BlID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMub3ZlcmxheUVsKSB7XG4gICAgICB0aGlzLm92ZXJsYXlFbC5yZW1vdmUoKTtcbiAgICAgIHRoaXMub3ZlcmxheUVsID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIFJpY2ggY29weSAobWFya2Rvd24gc2VsZWN0aW9uIFx1MjE5MiB0ZXh0L3BsYWluICsgdGV4dC9odG1sIHdpdGggZW1iZWRkZWQgaW1hZ2VzKSAtLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZVJpY2hDbGlwYm9hcmQobWFya2Rvd246IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNvdXJjZVBhdGggPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpPy5wYXRoID8/ICcnO1xuICAgIGNvbnN0IGh0bWwgPSBhd2FpdCB0aGlzLm1hcmtkb3duVG9IdG1sV2l0aEVtYmVkZGVkSW1hZ2VzKG1hcmtkb3duLCBzb3VyY2VQYXRoKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBodG1sQmxvYiA9IG5ldyBCbG9iKFtodG1sXSwgeyB0eXBlOiAndGV4dC9odG1sJyB9KTtcbiAgICAgIGNvbnN0IHRleHRCbG9iID0gbmV3IEJsb2IoW21hcmtkb3duXSwgeyB0eXBlOiAndGV4dC9wbGFpbicgfSk7XG4gICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlKFtcbiAgICAgICAgbmV3IENsaXBib2FyZEl0ZW0oeyAndGV4dC9odG1sJzogaHRtbEJsb2IsICd0ZXh0L3BsYWluJzogdGV4dEJsb2IgfSksXG4gICAgICBdKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1JpY2ggY2xpcGJvYXJkIHdyaXRlIGZhaWxlZCcsIGVycik7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChtYXJrZG93bik7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHknKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIG1hcmtkb3duVG9IdG1sV2l0aEVtYmVkZGVkSW1hZ2VzKG1hcmtkb3duOiBzdHJpbmcsIHNvdXJjZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgLy8gQ29sbGVjdCBhbGwgaW1hZ2UgcmVmcyBmaXJzdCwgcmVzb2x2ZSB0byBkYXRhIFVSTHMgaW4gcGFyYWxsZWxcbiAgICBjb25zdCByZWZzOiBBcnJheTx7IHJhdzogc3RyaW5nOyBzcmM6IHN0cmluZzsgYWx0OiBzdHJpbmcgfT4gPSBbXTtcbiAgICBjb25zdCBjb2xsZWN0ID0gKHJhdzogc3RyaW5nLCBzcmM6IHN0cmluZywgYWx0OiBzdHJpbmcpID0+IHtcbiAgICAgIHJlZnMucHVzaCh7IHJhdywgc3JjLCBhbHQgfSk7XG4gICAgfTtcblxuICAgIC8vIFBhdHRlcm46ICFbW3BhdGh8YWx0XV0gb3IgIVtbcGF0aF1dXG4gICAgbWFya2Rvd24ucmVwbGFjZSgvIVxcW1xcWyhbXlxcXV0rKVxcXVxcXS9nLCAocmF3LCBpbm5lcjogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBbbGlua3BhdGgsIGFsdCA9ICcnXSA9IGlubmVyLnNwbGl0KCd8Jyk7XG4gICAgICBjb2xsZWN0KHJhdywgbGlua3BhdGgudHJpbSgpLCBhbHQudHJpbSgpKTtcbiAgICAgIHJldHVybiByYXc7XG4gICAgfSk7XG4gICAgLy8gUGF0dGVybjogIVthbHRdKHVybClcbiAgICBtYXJrZG93bi5yZXBsYWNlKC8hXFxbKFteXFxdXSopXFxdXFwoKFteKV0rKVxcKS9nLCAocmF3LCBhbHQ6IHN0cmluZywgc3JjOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbGxlY3QocmF3LCBzcmMudHJpbSgpLCBhbHQpO1xuICAgICAgcmV0dXJuIHJhdztcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc29sdmVkID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTsgLy8gcmF3IFx1MjE5MiBmaW5hbCBzcmMgKGRhdGEgVVJMIG9yIG9yaWdpbmFsKVxuICAgIGF3YWl0IFByb21pc2UuYWxsKHJlZnMubWFwKGFzeW5jICh7IHJhdywgc3JjLCBhbHQgfSkgPT4ge1xuICAgICAgY29uc3QgZmluYWxTcmMgPSBhd2FpdCB0aGlzLnJlc29sdmVJbWFnZVNyYyhzcmMsIHNvdXJjZVBhdGgpO1xuICAgICAgcmVzb2x2ZWQuc2V0KHJhdywgZmluYWxTcmMgPz8gc3JjKTtcbiAgICB9KSk7XG5cbiAgICAvLyBSZW5kZXI6IHNwbGl0IGludG8gbGluZXMsIHJlcGxhY2UgaW1hZ2UgcmVmcyB3aXRoIDxpbWc+LCBlc2NhcGUgcmVzdFxuICAgIGNvbnN0IGxpbmVzID0gbWFya2Rvd24uc3BsaXQoJ1xcbicpO1xuICAgIGNvbnN0IGh0bWxMaW5lcyA9IGxpbmVzLm1hcCgobGluZSkgPT4ge1xuICAgICAgLy8gRmluZCBhbGwgaW1hZ2UtcmVmIG1hdGNoZXMgYW5kIHJlYnVpbGQgbGluZVxuICAgICAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gICAgICBsZXQgY3Vyc29yID0gMDtcbiAgICAgIGNvbnN0IGNvbWJpbmVkID0gLyFcXFtcXFsoW15cXF1dKylcXF1cXF18IVxcWyhbXlxcXV0qKVxcXVxcKChbXildKylcXCkvZztcbiAgICAgIGxldCBtOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsO1xuICAgICAgd2hpbGUgKChtID0gY29tYmluZWQuZXhlYyhsaW5lKSkgIT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgYmVmb3JlID0gbGluZS5zbGljZShjdXJzb3IsIG0uaW5kZXgpO1xuICAgICAgICBpZiAoYmVmb3JlKSBwYXJ0cy5wdXNoKGVzY2FwZUh0bWwoYmVmb3JlKSk7XG4gICAgICAgIGNvbnN0IHJhdyA9IG1bMF07XG4gICAgICAgIGNvbnN0IGFsdCA9IChtWzJdID8/IG1bMV0/LnNwbGl0KCd8JylbMV0gPz8gJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3QgZmluYWxTcmMgPSByZXNvbHZlZC5nZXQocmF3KSA/PyAnJztcbiAgICAgICAgcGFydHMucHVzaChgPGltZyBzcmM9XCIke2VzY2FwZUF0dHIoZmluYWxTcmMpfVwiIGFsdD1cIiR7ZXNjYXBlQXR0cihhbHQpfVwiPmApO1xuICAgICAgICBjdXJzb3IgPSBtLmluZGV4ICsgcmF3Lmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3QgPSBsaW5lLnNsaWNlKGN1cnNvcik7XG4gICAgICBpZiAocmVzdCkgcGFydHMucHVzaChlc2NhcGVIdG1sKHJlc3QpKTtcbiAgICAgIHJldHVybiBwYXJ0cy5qb2luKCcnKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBgPGRpdj4ke2h0bWxMaW5lcy5qb2luKCc8YnI+Jyl9PC9kaXY+YDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlU3JjKHNyYzogc3RyaW5nLCBzb3VyY2VQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICAvLyBBbHJlYWR5IGlubGluZSAvIHJlbW90ZVxuICAgIGlmIChzcmMuc3RhcnRzV2l0aCgnZGF0YTonKSkgcmV0dXJuIHNyYztcbiAgICBpZiAoL15odHRwcz86XFwvXFwvL2kudGVzdChzcmMpKSB7XG4gICAgICBjb25zdCBkYXRhVXJsID0gYXdhaXQgZmV0Y2hBc0RhdGFVcmwoc3JjKTtcbiAgICAgIHJldHVybiBkYXRhVXJsID8/IHNyYztcbiAgICB9XG5cbiAgICAvLyBWYXVsdC1yZXNvbHZlZCBwYXRoXG4gICAgY29uc3QgbGlua3BhdGggPSBkZWNvZGVVUklDb21wb25lbnQoc3JjKS5yZXBsYWNlKC9eXFwvKy8sICcnKTtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChsaW5rcGF0aCwgc291cmNlUGF0aCk7XG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkgcmV0dXJuIG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgYnVmID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZWFkQmluYXJ5KGZpbGUucGF0aCk7XG4gICAgICBpZiAoYnVmLmJ5dGVMZW5ndGggPiBNQVhfRU1CRURfQllURVMpIHtcbiAgICAgICAgbmV3IE5vdGljZShgU2tpcHBlZCBlbWJlZGRpbmcgKHRvbyBsYXJnZSk6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGV4dCA9IGZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBtaW1lID0gSU1BR0VfRVhUX01JTUVbZXh0XSA/PyAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJztcbiAgICAgIHJldHVybiBgZGF0YToke21pbWV9O2Jhc2U2NCwke2FycmF5QnVmZmVyVG9CYXNlNjQoYnVmKX1gO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHJlYWQgdmF1bHQgaW1hZ2UnLCBlcnIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0gSGVscGVycyAtLS0tXG5cbmZ1bmN0aW9uIGhhc0ltYWdlUmVmKHRleHQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gLyFcXFtcXFtbXlxcXV0rXFxdXFxdfCFcXFtbXlxcXV0qXFxdXFwoW14pXStcXCkvLnRlc3QodGV4dCk7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWwoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVBdHRyKHM6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvXCIvZywgJyZxdW90OycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7Jyk7XG59XG5cbmZ1bmN0aW9uIGFycmF5QnVmZmVyVG9CYXNlNjQoYnVmOiBBcnJheUJ1ZmZlcik6IHN0cmluZyB7XG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYnVmKTtcbiAgY29uc3QgQ0hVTksgPSAweDgwMDA7XG4gIGxldCBiaW5hcnkgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gQ0hVTkspIHtcbiAgICBjb25zdCBzdWIgPSBieXRlcy5zdWJhcnJheShpLCBpICsgQ0hVTkspO1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIEFycmF5LmZyb20oc3ViKSk7XG4gIH1cbiAgcmV0dXJuIGJ0b2EoYmluYXJ5KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBc0RhdGFVcmwodXJsOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgIGlmICghcmVzLm9rKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBibG9iID0gYXdhaXQgcmVzLmJsb2IoKTtcbiAgICBpZiAoYmxvYi5zaXplID4gTUFYX0VNQkVEX0JZVEVTKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBibG9iLmFycmF5QnVmZmVyKCk7XG4gICAgY29uc3QgbWltZSA9IGJsb2IudHlwZSB8fCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJztcbiAgICByZXR1cm4gYGRhdGE6JHttaW1lfTtiYXNlNjQsJHthcnJheUJ1ZmZlclRvQmFzZTY0KGJ1Zil9YDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHNCQUFnRTtBQUVoRSxJQUFNLGVBQWU7QUFDckIsSUFBTSxjQUFjO0FBQ3BCLElBQU0sZUFBZTtBQUNyQixJQUFNLHFCQUFxQjtBQUMzQixJQUFNLGlCQUFpQjtBQUN2QixJQUFNLGtCQUFrQixJQUFJLE9BQU87QUFFbkMsSUFBTSxpQkFBeUM7QUFBQSxFQUM3QyxLQUFLO0FBQUEsRUFDTCxLQUFLO0FBQUEsRUFDTCxNQUFNO0FBQUEsRUFDTixLQUFLO0FBQUEsRUFDTCxNQUFNO0FBQUEsRUFDTixLQUFLO0FBQUEsRUFDTCxLQUFLO0FBQUEsRUFDTCxNQUFNO0FBQ1I7QUFXQSxJQUFxQixxQkFBckIsY0FBZ0QsdUJBQU87QUFBQSxFQUF2RDtBQUFBO0FBQ0UsU0FBUSxZQUFtQztBQUMzQyxTQUFRLFVBQW1CLEVBQUUsVUFBVSxHQUFHLFdBQVcsR0FBRyxXQUFXLEdBQUcsWUFBWSxHQUFHLE1BQU0sR0FBRyxLQUFLLEVBQUU7QUFDckcsU0FBUSxlQUE2QjtBQUNyQyxTQUFRLHlCQUFp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
