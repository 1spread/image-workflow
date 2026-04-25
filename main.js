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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgRmlsZVN5c3RlbUFkYXB0ZXIsIE5vdGljZSwgUGx1Z2luLCBTY29wZSwgVEZpbGUgfSBmcm9tICdvYnNpZGlhbic7XG5cbmNvbnN0IElNR19TRUxFQ1RPUiA9IGAud29ya3NwYWNlLWxlYWYtY29udGVudFtkYXRhLXR5cGU9J21hcmtkb3duJ10gaW1nOm5vdChhIGltZyksIC53b3Jrc3BhY2UtbGVhZi1jb250ZW50W2RhdGEtdHlwZT0naW1hZ2UnXSBpbWdgO1xuY29uc3QgWk9PTV9GQUNUT1IgPSAwLjg7XG5jb25zdCBJTUdfVklFV19NSU4gPSAzMDtcbmNvbnN0IEJVVFRPTl9BUkVBX0hFSUdIVCA9IDEwMDsgLy8gYm90dG9tIGJ1dHRvbiBncm91cCBjbGVhcmFuY2VcbmNvbnN0IE1BWF9DQU5WQVNfRElNID0gODE5MjtcbmNvbnN0IE1BWF9FTUJFRF9CWVRFUyA9IDUgKiAxMDI0ICogMTAyNDsgLy8gNU1CIHBlciBpbWFnZVxuXG5jb25zdCBJTUFHRV9FWFRfTUlNRTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgcG5nOiAnaW1hZ2UvcG5nJyxcbiAganBnOiAnaW1hZ2UvanBlZycsXG4gIGpwZWc6ICdpbWFnZS9qcGVnJyxcbiAgZ2lmOiAnaW1hZ2UvZ2lmJyxcbiAgd2VicDogJ2ltYWdlL3dlYnAnLFxuICBzdmc6ICdpbWFnZS9zdmcreG1sJyxcbiAgYm1wOiAnaW1hZ2UvYm1wJyxcbiAgYXZpZjogJ2ltYWdlL2F2aWYnLFxufTtcblxuaW50ZXJmYWNlIEltZ0luZm8ge1xuICBjdXJXaWR0aDogbnVtYmVyO1xuICBjdXJIZWlnaHQ6IG51bWJlcjtcbiAgcmVhbFdpZHRoOiBudW1iZXI7XG4gIHJlYWxIZWlnaHQ6IG51bWJlcjtcbiAgbGVmdDogbnVtYmVyO1xuICB0b3A6IG51bWJlcjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgSW1hZ2VFbmxhcmdlUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgcHJpdmF0ZSBvdmVybGF5RWw6IEhUTUxEaXZFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaW1nSW5mbzogSW1nSW5mbyA9IHsgY3VyV2lkdGg6IDAsIGN1ckhlaWdodDogMCwgcmVhbFdpZHRoOiAwLCByZWFsSGVpZ2h0OiAwLCBsZWZ0OiAwLCB0b3A6IDAgfTtcbiAgcHJpdmF0ZSBvdmVybGF5U2NvcGU6IFNjb3BlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgb3ZlcmxheUFib3J0Q29udHJvbGxlcjogQWJvcnRDb250cm9sbGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmFmSWQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuXG4gIHByaXZhdGUgaGFuZGxlSW1hZ2VDbGljayA9IChldnQ6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBjb25zdCB0YXJnZXQgPSBldnQudGFyZ2V0IGFzIEhUTUxFbGVtZW50O1xuICAgIGNvbnN0IGltZyA9IHRhcmdldCBpbnN0YW5jZW9mIEhUTUxJbWFnZUVsZW1lbnRcbiAgICAgID8gdGFyZ2V0XG4gICAgICA6IHRhcmdldC5jbG9zZXN0KCdpbWcnKTtcbiAgICBpZiAoIWltZyB8fCAhKGltZyBpbnN0YW5jZW9mIEhUTUxJbWFnZUVsZW1lbnQpKSByZXR1cm47XG4gICAgaWYgKCFpbWcubWF0Y2hlcyhJTUdfU0VMRUNUT1IpKSByZXR1cm47XG4gICAgaWYgKHRoaXMub3ZlcmxheUVsKSByZXR1cm47XG4gICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpOyAvLyBPYnNpZGlhbiBcdTUwNzRcdTMwNkVcdTMwQ0ZcdTMwRjNcdTMwQzlcdTMwRTlcdTMwNENcdTc1M0JcdTUwQ0ZcdTMwOTJcdTUyMjVcdTMwREFcdTMwQTRcdTMwRjNcdTMwNjdcdTk1OEJcdTMwNEZcdTMwNkVcdTMwOTJcdTk2MzJcdTMwNTBcbiAgICB0aGlzLm9wZW5PdmVybGF5KGltZy5zcmMpO1xuICB9O1xuXG4gIHByaXZhdGUgaGFuZGxlQ29weSA9IChldnQ6IENsaXBib2FyZEV2ZW50KSA9PiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gZXZ0LnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgLy8gT25seSBpbnRlcmNlcHQgY29waWVzIG9yaWdpbmF0aW5nIGZyb20gYSBtYXJrZG93biBsZWFmXG4gICAgaWYgKCF0YXJnZXQgfHwgIXRhcmdldC5jbG9zZXN0KGAud29ya3NwYWNlLWxlYWYtY29udGVudFtkYXRhLXR5cGU9J21hcmtkb3duJ11gKSkgcmV0dXJuO1xuXG4gICAgY29uc3Qgc2VsZWN0aW9uID0gd2luZG93LmdldFNlbGVjdGlvbigpO1xuICAgIGNvbnN0IHRleHQgPSBzZWxlY3Rpb24/LnRvU3RyaW5nKCk7XG4gICAgaWYgKCF0ZXh0KSByZXR1cm47XG5cbiAgICBpZiAoIWhhc0ltYWdlUmVmKHRleHQpKSByZXR1cm47XG5cbiAgICAvLyBXZSB3aWxsIGhhbmRsZSB0aGlzIGNvcHk6IHByZXZlbnQgZGVmYXVsdCBhbmQgd3JpdGUgYXN5bmNocm9ub3VzbHkuXG4gICAgZXZ0LnByZXZlbnREZWZhdWx0KCk7XG4gICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIHZvaWQgdGhpcy53cml0ZVJpY2hDbGlwYm9hcmQodGV4dCk7XG4gIH07XG5cbiAgb25sb2FkKCkge1xuICAgIC8vIGNhcHR1cmU6IHRydWUgXHUyMDE0IE9ic2lkaWFuL0NNNiBcdTMwNkUgc3RvcFByb3BhZ2F0aW9uIFx1MzA4OFx1MzA4QVx1NTE0OFx1MzA2Qlx1NzY3QVx1NzA2QlxuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgJ2NsaWNrJywgdGhpcy5oYW5kbGVJbWFnZUNsaWNrLCB0cnVlKTtcbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQoZG9jdW1lbnQsICdjb3B5JywgdGhpcy5oYW5kbGVDb3B5LCB0cnVlKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge1xuICAgIHRoaXMuY2xvc2VPdmVybGF5KCk7XG4gIH1cblxuICBwcml2YXRlIG9wZW5PdmVybGF5KHNyYzogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMub3ZlcmxheUVsKSByZXR1cm47XG5cbiAgICBjb25zdCBvdmVybGF5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgb3ZlcmxheS5hZGRDbGFzcygnaW1hZ2UtZW5sYXJnZS1vdmVybGF5Jyk7XG4gICAgdGhpcy5vdmVybGF5RWwgPSBvdmVybGF5O1xuXG4gICAgY29uc3QgaW1nVmlldyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2ltZycpO1xuICAgIGltZ1ZpZXcuYWRkQ2xhc3MoJ2ltYWdlLWVubGFyZ2UtdmlldycpO1xuICAgIGltZ1ZpZXcuc3JjID0gc3JjO1xuXG4gICAgY29uc3QgYnRuR3JvdXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBidG5Hcm91cC5hZGRDbGFzcygnaW1hZ2UtZW5sYXJnZS1idG4tZ3JvdXAnKTtcblxuICAgIGNvbnN0IGNvcHlCdG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgICBjb3B5QnRuLmFkZENsYXNzKCdpbWFnZS1lbmxhcmdlLWJ0bicpO1xuICAgIGNvcHlCdG4udGV4dENvbnRlbnQgPSAnQ29weSc7XG5cbiAgICBjb25zdCBkb3dubG9hZEJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpO1xuICAgIGRvd25sb2FkQnRuLmFkZENsYXNzKCdpbWFnZS1lbmxhcmdlLWJ0bicpO1xuICAgIGRvd25sb2FkQnRuLnRleHRDb250ZW50ID0gJ0Rvd25sb2FkJztcblxuICAgIGNvbnN0IGNvcHlQYXRoQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgY29weVBhdGhCdG4uYWRkQ2xhc3MoJ2ltYWdlLWVubGFyZ2UtYnRuJyk7XG4gICAgY29weVBhdGhCdG4udGV4dENvbnRlbnQgPSAnQ29weSBQYXRoJztcblxuICAgIGJ0bkdyb3VwLmFwcGVuZENoaWxkKGNvcHlCdG4pO1xuICAgIGJ0bkdyb3VwLmFwcGVuZENoaWxkKGRvd25sb2FkQnRuKTtcbiAgICBidG5Hcm91cC5hcHBlbmRDaGlsZChjb3B5UGF0aEJ0bik7XG4gICAgb3ZlcmxheS5hcHBlbmRDaGlsZChpbWdWaWV3KTtcbiAgICBvdmVybGF5LmFwcGVuZENoaWxkKGJ0bkdyb3VwKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG92ZXJsYXkpO1xuXG4gICAgaWYgKGltZ1ZpZXcuY29tcGxldGUgJiYgaW1nVmlldy5uYXR1cmFsV2lkdGggPiAwKSB7XG4gICAgICB0aGlzLmNhbGN1bGF0ZUZpdFNpemUoaW1nVmlldyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGltZ1ZpZXcub25sb2FkID0gKCkgPT4ge1xuICAgICAgICBpZiAoIXRoaXMub3ZlcmxheUVsKSByZXR1cm47XG4gICAgICAgIHRoaXMuY2FsY3VsYXRlRml0U2l6ZShpbWdWaWV3KTtcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICB0aGlzLm92ZXJsYXlBYm9ydENvbnRyb2xsZXIgPSBjb250cm9sbGVyO1xuICAgIGNvbnN0IHsgc2lnbmFsIH0gPSBjb250cm9sbGVyO1xuXG4gICAgaW1nVmlldy5hZGRFdmVudExpc3RlbmVyKCdkcmFnc3RhcnQnLCAoZSkgPT4gZS5wcmV2ZW50RGVmYXVsdCgpLCB7IHNpZ25hbCB9KTtcblxuICAgIG92ZXJsYXkuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4ge1xuICAgICAgaWYgKGUudGFyZ2V0ID09PSBvdmVybGF5KSB0aGlzLmNsb3NlT3ZlcmxheSgpO1xuICAgIH0sIHsgc2lnbmFsIH0pO1xuXG4gICAgdGhpcy5vdmVybGF5U2NvcGUgPSBuZXcgU2NvcGUoKTtcbiAgICB0aGlzLm92ZXJsYXlTY29wZS5yZWdpc3RlcihudWxsLCAnRXNjYXBlJywgKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZU92ZXJsYXkoKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9KTtcbiAgICB0aGlzLm92ZXJsYXlTY29wZS5yZWdpc3RlcihbJ01vZCddLCAnYycsICgpID0+IHtcbiAgICAgIHRoaXMuY29weUltYWdlVG9DbGlwYm9hcmQoaW1nVmlldyk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSk7XG4gICAgdGhpcy5vdmVybGF5U2NvcGUucmVnaXN0ZXIoWydNb2QnLCAnU2hpZnQnXSwgJ2MnLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvcHlJbWFnZVBhdGgoc3JjKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9KTtcbiAgICB0aGlzLm92ZXJsYXlTY29wZS5yZWdpc3RlcihbJ01vZCddLCAncycsICgpID0+IHtcbiAgICAgIHRoaXMuZG93bmxvYWRJbWFnZShzcmMpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0pO1xuICAgIHRoaXMuYXBwLmtleW1hcC5wdXNoU2NvcGUodGhpcy5vdmVybGF5U2NvcGUpO1xuXG4gICAgaW1nVmlldy5hZGRFdmVudExpc3RlbmVyKCd3aGVlbCcsIChlKSA9PiB7XG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBjb25zdCB6b29tSW4gPSBlLmRlbHRhWSA8IDA7XG4gICAgICBjb25zdCByYXRpbyA9IHpvb21JbiA/IDAuMSA6IC0wLjE7XG4gICAgICBjb25zdCByZWN0ID0gaW1nVmlldy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIGNvbnN0IG9mZnNldFggPSBlLmNsaWVudFggLSByZWN0LmxlZnQ7XG4gICAgICBjb25zdCBvZmZzZXRZID0gZS5jbGllbnRZIC0gcmVjdC50b3A7XG4gICAgICBpZiAodGhpcy5yYWZJZCAhPT0gbnVsbCkgY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5yYWZJZCk7XG4gICAgICB0aGlzLnJhZklkID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHtcbiAgICAgICAgdGhpcy5yYWZJZCA9IG51bGw7XG4gICAgICAgIHRoaXMuem9vbShyYXRpbywgeyBvZmZzZXRYLCBvZmZzZXRZIH0pO1xuICAgICAgICB0aGlzLmFwcGx5VHJhbnNmb3JtKGltZ1ZpZXcpO1xuICAgICAgfSk7XG4gICAgfSwgeyBzaWduYWwgfSk7XG5cbiAgICBjb3B5QnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcbiAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLmNvcHlJbWFnZVRvQ2xpcGJvYXJkKGltZ1ZpZXcpO1xuICAgIH0sIHsgc2lnbmFsIH0pO1xuXG4gICAgZG93bmxvYWRCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4ge1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMuZG93bmxvYWRJbWFnZShzcmMpO1xuICAgIH0sIHsgc2lnbmFsIH0pO1xuXG4gICAgY29weVBhdGhCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4ge1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMuY29weUltYWdlUGF0aChzcmMpO1xuICAgIH0sIHsgc2lnbmFsIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjYWxjdWxhdGVGaXRTaXplKGltZ1ZpZXc6IEhUTUxJbWFnZUVsZW1lbnQpIHtcbiAgICBjb25zdCB3aW5XID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudFdpZHRoO1xuICAgIGNvbnN0IHdpbkggPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuY2xpZW50SGVpZ2h0IC0gQlVUVE9OX0FSRUFfSEVJR0hUO1xuICAgIGNvbnN0IHpvb21XID0gd2luVyAqIFpPT01fRkFDVE9SO1xuICAgIGNvbnN0IHpvb21IID0gd2luSCAqIFpPT01fRkFDVE9SO1xuXG4gICAgbGV0IHcgPSBpbWdWaWV3Lm5hdHVyYWxXaWR0aCwgaCA9IGltZ1ZpZXcubmF0dXJhbEhlaWdodDtcbiAgICBpZiAoaCA+IHpvb21IKSB7XG4gICAgICBoID0gem9vbUg7XG4gICAgICB3ID0gaCAvIGltZ1ZpZXcubmF0dXJhbEhlaWdodCAqIGltZ1ZpZXcubmF0dXJhbFdpZHRoO1xuICAgICAgaWYgKHcgPiB6b29tVykgdyA9IHpvb21XO1xuICAgIH0gZWxzZSBpZiAodyA+IHpvb21XKSB7XG4gICAgICB3ID0gem9vbVc7XG4gICAgfVxuICAgIGggPSB3ICogaW1nVmlldy5uYXR1cmFsSGVpZ2h0IC8gaW1nVmlldy5uYXR1cmFsV2lkdGg7XG5cbiAgICB0aGlzLmltZ0luZm8gPSB7XG4gICAgICBjdXJXaWR0aDogdyxcbiAgICAgIGN1ckhlaWdodDogaCxcbiAgICAgIHJlYWxXaWR0aDogaW1nVmlldy5uYXR1cmFsV2lkdGgsXG4gICAgICByZWFsSGVpZ2h0OiBpbWdWaWV3Lm5hdHVyYWxIZWlnaHQsXG4gICAgICBsZWZ0OiAod2luVyAtIHcpIC8gMixcbiAgICAgIHRvcDogKHdpbkggLSBoKSAvIDIsXG4gICAgfTtcbiAgICB0aGlzLmFwcGx5VHJhbnNmb3JtKGltZ1ZpZXcpO1xuICB9XG5cbiAgcHJpdmF0ZSB6b29tKHJhdGlvOiBudW1iZXIsIG9mZnNldDogeyBvZmZzZXRYOiBudW1iZXI7IG9mZnNldFk6IG51bWJlciB9KSB7XG4gICAgY29uc3QgaW5mbyA9IHRoaXMuaW1nSW5mbztcbiAgICBjb25zdCB6b29tSW4gPSByYXRpbyA+IDA7XG4gICAgY29uc3QgbXVsdGlwbGllciA9IHpvb21JbiA/IDEgKyByYXRpbyA6IDEgLyAoMSAtIHJhdGlvKTtcbiAgICBsZXQgem9vbVJhdGlvID0gaW5mby5jdXJXaWR0aCAqIG11bHRpcGxpZXIgLyBpbmZvLnJlYWxXaWR0aDtcblxuICAgIGNvbnN0IGN1clJhdGlvID0gaW5mby5jdXJXaWR0aCAvIGluZm8ucmVhbFdpZHRoO1xuICAgIGlmICgoY3VyUmF0aW8gPCAxICYmIHpvb21SYXRpbyA+IDEpIHx8IChjdXJSYXRpbyA+IDEgJiYgem9vbVJhdGlvIDwgMSkpIHtcbiAgICAgIHpvb21SYXRpbyA9IDE7XG4gICAgICBjb25zdCBzbmFwTXVsdGlwbGllciA9IDEgLyBjdXJSYXRpbztcbiAgICAgIGluZm8ubGVmdCArPSBvZmZzZXQub2Zmc2V0WCAqICgxIC0gc25hcE11bHRpcGxpZXIpO1xuICAgICAgaW5mby50b3AgKz0gb2Zmc2V0Lm9mZnNldFkgKiAoMSAtIHNuYXBNdWx0aXBsaWVyKTtcbiAgICAgIGluZm8uY3VyV2lkdGggPSBpbmZvLnJlYWxXaWR0aDtcbiAgICAgIGluZm8uY3VySGVpZ2h0ID0gaW5mby5yZWFsSGVpZ2h0O1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGxldCBuZXdXID0gaW5mby5yZWFsV2lkdGggKiB6b29tUmF0aW87XG4gICAgbGV0IG5ld0ggPSBpbmZvLnJlYWxIZWlnaHQgKiB6b29tUmF0aW87XG5cbiAgICBpZiAobmV3VyA8IElNR19WSUVXX01JTiB8fCBuZXdIIDwgSU1HX1ZJRVdfTUlOKSB7XG4gICAgICBpZiAobmV3VyA8IElNR19WSUVXX01JTikge1xuICAgICAgICBuZXdXID0gSU1HX1ZJRVdfTUlOO1xuICAgICAgICBuZXdIID0gbmV3VyAqIGluZm8ucmVhbEhlaWdodCAvIGluZm8ucmVhbFdpZHRoO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV3SCA9IElNR19WSUVXX01JTjtcbiAgICAgICAgbmV3VyA9IG5ld0ggKiBpbmZvLnJlYWxXaWR0aCAvIGluZm8ucmVhbEhlaWdodDtcbiAgICAgIH1cbiAgICAgIGluZm8uY3VyV2lkdGggPSBuZXdXO1xuICAgICAgaW5mby5jdXJIZWlnaHQgPSBuZXdIO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGluZm8ubGVmdCArPSBvZmZzZXQub2Zmc2V0WCAqICgxIC0gbXVsdGlwbGllcik7XG4gICAgaW5mby50b3AgKz0gb2Zmc2V0Lm9mZnNldFkgKiAoMSAtIG11bHRpcGxpZXIpO1xuICAgIGluZm8uY3VyV2lkdGggPSBuZXdXO1xuICAgIGluZm8uY3VySGVpZ2h0ID0gbmV3SDtcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlUcmFuc2Zvcm0oaW1nVmlldzogSFRNTEltYWdlRWxlbWVudCkge1xuICAgIGNvbnN0IGluZm8gPSB0aGlzLmltZ0luZm87XG4gICAgaW1nVmlldy5zdHlsZS53aWR0aCA9IGAke2luZm8uY3VyV2lkdGh9cHhgO1xuICAgIGltZ1ZpZXcuc3R5bGUuaGVpZ2h0ID0gYCR7aW5mby5jdXJIZWlnaHR9cHhgO1xuICAgIGltZ1ZpZXcuc3R5bGUudHJhbnNmb3JtID0gYHRyYW5zbGF0ZSgke2luZm8ubGVmdH1weCwgJHtpbmZvLnRvcH1weClgO1xuICB9XG5cbiAgcHJpdmF0ZSBzcmNUb1ZhdWx0UGF0aChzcmM6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgbGV0IHBhdGggPSBzcmM7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoc3JjKTtcbiAgICAgIGNvbnN0IGRlY29kZWRQYXRoID0gZGVjb2RlVVJJQ29tcG9uZW50KHVybC5wYXRobmFtZSk7XG4gICAgICBjb25zdCB2YXVsdEJhc2VQYXRoID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlciBpbnN0YW5jZW9mIEZpbGVTeXN0ZW1BZGFwdGVyXG4gICAgICAgID8gdGhpcy5hcHAudmF1bHQuYWRhcHRlci5nZXRCYXNlUGF0aCgpXG4gICAgICAgIDogbnVsbDtcbiAgICAgIGlmICh2YXVsdEJhc2VQYXRoICYmIGRlY29kZWRQYXRoLmluY2x1ZGVzKHZhdWx0QmFzZVBhdGgpKSB7XG4gICAgICAgIGNvbnN0IGlkeCA9IGRlY29kZWRQYXRoLmluZGV4T2YodmF1bHRCYXNlUGF0aCk7XG4gICAgICAgIHBhdGggPSBkZWNvZGVkUGF0aC5zdWJzdHJpbmcoaWR4ICsgdmF1bHRCYXNlUGF0aC5sZW5ndGgpO1xuICAgICAgICBpZiAocGF0aC5zdGFydHNXaXRoKCcvJykpIHBhdGggPSBwYXRoLnN1YnN0cmluZygxKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdGggPSBkZWNvZGVkUGF0aDtcbiAgICAgICAgaWYgKHBhdGguc3RhcnRzV2l0aCgnLycpKSBwYXRoID0gcGF0aC5zdWJzdHJpbmcoMSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBub3QgYSB2YWxpZCBVUkwgXHUyMDE0IHVzZSBhcy1pc1xuICAgIH1cbiAgICByZXR1cm4gcGF0aDtcbiAgfVxuXG4gIHByaXZhdGUgY29weUltYWdlUGF0aChzcmM6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IHBhdGggPSB0aGlzLnNyY1RvVmF1bHRQYXRoKHNyYyk7XG4gICAgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQocGF0aCkudGhlbihcbiAgICAgICgpID0+IG5ldyBOb3RpY2UoJ1BhdGggY29waWVkOiAnICsgcGF0aCksXG4gICAgICAoKSA9PiBuZXcgTm90aWNlKCdGYWlsZWQgdG8gY29weSBwYXRoJylcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBkb3dubG9hZEltYWdlKHNyYzogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHNyYyk7XG4gICAgICBpZiAoIXJlcy5vaykgdGhyb3cgbmV3IEVycm9yKCdmZXRjaCBmYWlsZWQnKTtcbiAgICAgIGNvbnN0IGJsb2IgPSBhd2FpdCByZXMuYmxvYigpO1xuICAgICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICAgIGNvbnN0IHBhdGggPSB0aGlzLnNyY1RvVmF1bHRQYXRoKHNyYyk7XG4gICAgICBjb25zdCBmaWxlbmFtZSA9IHBhdGguc3BsaXQoJy8nKS5wb3AoKSB8fCAnaW1hZ2UnO1xuICAgICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcbiAgICAgIGEuaHJlZiA9IHVybDtcbiAgICAgIGEuZG93bmxvYWQgPSBmaWxlbmFtZTtcbiAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoYSk7XG4gICAgICBhLmNsaWNrKCk7XG4gICAgICBhLnJlbW92ZSgpO1xuICAgICAgLy8gUmV2b2tlIGFmdGVyIGEgdGljayBzbyB0aGUgZG93bmxvYWQgaGFzIHRpbWUgdG8gc3RhcnRcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCAxMDAwKTtcbiAgICAgIG5ldyBOb3RpY2UoJ0Rvd25sb2FkZWQ6ICcgKyBmaWxlbmFtZSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gZG93bmxvYWQnKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNvcHlJbWFnZVRvQ2xpcGJvYXJkKGltZ1ZpZXc6IEhUTUxJbWFnZUVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBpbWFnZSA9IG5ldyBJbWFnZSgpO1xuICAgIGNvbnN0IGlzRmlsZVVybCA9IGltZ1ZpZXcuc3JjLnN0YXJ0c1dpdGgoJ2ZpbGU6Jyk7XG4gICAgaWYgKCFpc0ZpbGVVcmwpIHtcbiAgICAgIGltYWdlLmNyb3NzT3JpZ2luID0gJ2Fub255bW91cyc7XG4gICAgfVxuICAgIGltYWdlLnNyYyA9IGltZ1ZpZXcuc3JjO1xuICAgIGltYWdlLm9ubG9hZCA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICAgICAgbGV0IHcgPSBpbWFnZS5uYXR1cmFsV2lkdGg7XG4gICAgICBsZXQgaCA9IGltYWdlLm5hdHVyYWxIZWlnaHQ7XG4gICAgICBpZiAodyA+IE1BWF9DQU5WQVNfRElNIHx8IGggPiBNQVhfQ0FOVkFTX0RJTSkge1xuICAgICAgICBjb25zdCBzY2FsZSA9IE1hdGgubWluKE1BWF9DQU5WQVNfRElNIC8gdywgTUFYX0NBTlZBU19ESU0gLyBoKTtcbiAgICAgICAgdyA9IE1hdGguZmxvb3IodyAqIHNjYWxlKTtcbiAgICAgICAgaCA9IE1hdGguZmxvb3IoaCAqIHNjYWxlKTtcbiAgICAgIH1cbiAgICAgIGNhbnZhcy53aWR0aCA9IHc7XG4gICAgICBjYW52YXMuaGVpZ2h0ID0gaDtcbiAgICAgIGNvbnN0IGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgICAgaWYgKCFjdHgpIHJldHVybjtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSAnI2ZmZic7XG4gICAgICBjdHguZmlsbFJlY3QoMCwgMCwgY2FudmFzLndpZHRoLCBjYW52YXMuaGVpZ2h0KTtcbiAgICAgIGN0eC5kcmF3SW1hZ2UoaW1hZ2UsIDAsIDAsIHcsIGgpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2FudmFzLnRvQmxvYihhc3luYyAoYmxvYikgPT4ge1xuICAgICAgICAgIGNhbnZhcy53aWR0aCA9IDA7XG4gICAgICAgICAgaWYgKCFibG9iKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gY29weSBpbWFnZScpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZShbXG4gICAgICAgICAgICAgIG5ldyBDbGlwYm9hcmRJdGVtKHsgJ2ltYWdlL3BuZyc6IGJsb2IgfSksXG4gICAgICAgICAgICBdKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoJ0ltYWdlIGNvcGllZCcpO1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHkgaW1hZ2UnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ0ZhaWxlZCB0byBjb3B5IGltYWdlJyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGltYWdlLm9uZXJyb3IgPSAoKSA9PiB7XG4gICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gY29weSBpbWFnZScpO1xuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGNsb3NlT3ZlcmxheSgpIHtcbiAgICBpZiAodGhpcy5yYWZJZCAhPT0gbnVsbCkge1xuICAgICAgY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5yYWZJZCk7XG4gICAgICB0aGlzLnJhZklkID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMub3ZlcmxheUFib3J0Q29udHJvbGxlcikge1xuICAgICAgdGhpcy5vdmVybGF5QWJvcnRDb250cm9sbGVyLmFib3J0KCk7XG4gICAgICB0aGlzLm92ZXJsYXlBYm9ydENvbnRyb2xsZXIgPSBudWxsO1xuICAgIH1cbiAgICBpZiAodGhpcy5vdmVybGF5U2NvcGUpIHtcbiAgICAgIHRoaXMuYXBwLmtleW1hcC5wb3BTY29wZSh0aGlzLm92ZXJsYXlTY29wZSk7XG4gICAgICB0aGlzLm92ZXJsYXlTY29wZSA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0aGlzLm92ZXJsYXlFbCkge1xuICAgICAgdGhpcy5vdmVybGF5RWwucmVtb3ZlKCk7XG4gICAgICB0aGlzLm92ZXJsYXlFbCA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLSBSaWNoIGNvcHkgKG1hcmtkb3duIHNlbGVjdGlvbiBcdTIxOTIgdGV4dC9wbGFpbiArIHRleHQvaHRtbCB3aXRoIGVtYmVkZGVkIGltYWdlcykgLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVSaWNoQ2xpcGJvYXJkKG1hcmtkb3duOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzb3VyY2VQYXRoID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKT8ucGF0aCA/PyAnJztcbiAgICBjb25zdCBodG1sID0gYXdhaXQgdGhpcy5tYXJrZG93blRvSHRtbFdpdGhFbWJlZGRlZEltYWdlcyhtYXJrZG93biwgc291cmNlUGF0aCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgaHRtbEJsb2IgPSBuZXcgQmxvYihbaHRtbF0sIHsgdHlwZTogJ3RleHQvaHRtbCcgfSk7XG4gICAgICBjb25zdCB0ZXh0QmxvYiA9IG5ldyBCbG9iKFttYXJrZG93bl0sIHsgdHlwZTogJ3RleHQvcGxhaW4nIH0pO1xuICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZShbXG4gICAgICAgIG5ldyBDbGlwYm9hcmRJdGVtKHsgJ3RleHQvaHRtbCc6IGh0bWxCbG9iLCAndGV4dC9wbGFpbic6IHRleHRCbG9iIH0pLFxuICAgICAgXSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdSaWNoIGNsaXBib2FyZCB3cml0ZSBmYWlsZWQnLCBlcnIpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQobWFya2Rvd24pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ0ZhaWxlZCB0byBjb3B5Jyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBtYXJrZG93blRvSHRtbFdpdGhFbWJlZGRlZEltYWdlcyhtYXJrZG93bjogc3RyaW5nLCBzb3VyY2VQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIC8vIENvbGxlY3QgYWxsIGltYWdlIHJlZnMgZmlyc3QsIHJlc29sdmUgdG8gZGF0YSBVUkxzIGluIHBhcmFsbGVsXG4gICAgY29uc3QgcmVmczogQXJyYXk8eyByYXc6IHN0cmluZzsgc3JjOiBzdHJpbmc7IGFsdDogc3RyaW5nIH0+ID0gW107XG4gICAgY29uc3QgY29sbGVjdCA9IChyYXc6IHN0cmluZywgc3JjOiBzdHJpbmcsIGFsdDogc3RyaW5nKSA9PiB7XG4gICAgICByZWZzLnB1c2goeyByYXcsIHNyYywgYWx0IH0pO1xuICAgIH07XG5cbiAgICAvLyBQYXR0ZXJuOiAhW1twYXRofGFsdF1dIG9yICFbW3BhdGhdXVxuICAgIG1hcmtkb3duLnJlcGxhY2UoLyFcXFtcXFsoW15cXF1dKylcXF1cXF0vZywgKHJhdywgaW5uZXI6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgW2xpbmtwYXRoLCBhbHQgPSAnJ10gPSBpbm5lci5zcGxpdCgnfCcpO1xuICAgICAgY29sbGVjdChyYXcsIGxpbmtwYXRoLnRyaW0oKSwgYWx0LnRyaW0oKSk7XG4gICAgICByZXR1cm4gcmF3O1xuICAgIH0pO1xuICAgIC8vIFBhdHRlcm46ICFbYWx0XSh1cmwpXG4gICAgbWFya2Rvd24ucmVwbGFjZSgvIVxcWyhbXlxcXV0qKVxcXVxcKChbXildKylcXCkvZywgKHJhdywgYWx0OiBzdHJpbmcsIHNyYzogc3RyaW5nKSA9PiB7XG4gICAgICBjb2xsZWN0KHJhdywgc3JjLnRyaW0oKSwgYWx0KTtcbiAgICAgIHJldHVybiByYXc7XG4gICAgfSk7XG5cbiAgICBjb25zdCByZXNvbHZlZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7IC8vIHJhdyBcdTIxOTIgZmluYWwgc3JjIChkYXRhIFVSTCBvciBvcmlnaW5hbClcbiAgICBhd2FpdCBQcm9taXNlLmFsbChyZWZzLm1hcChhc3luYyAoeyByYXcsIHNyYywgYWx0IH0pID0+IHtcbiAgICAgIGNvbnN0IGZpbmFsU3JjID0gYXdhaXQgdGhpcy5yZXNvbHZlSW1hZ2VTcmMoc3JjLCBzb3VyY2VQYXRoKTtcbiAgICAgIHJlc29sdmVkLnNldChyYXcsIGZpbmFsU3JjID8/IHNyYyk7XG4gICAgfSkpO1xuXG4gICAgLy8gUmVuZGVyOiBzcGxpdCBpbnRvIGxpbmVzLCByZXBsYWNlIGltYWdlIHJlZnMgd2l0aCA8aW1nPiwgZXNjYXBlIHJlc3RcbiAgICBjb25zdCBsaW5lcyA9IG1hcmtkb3duLnNwbGl0KCdcXG4nKTtcbiAgICBjb25zdCBodG1sTGluZXMgPSBsaW5lcy5tYXAoKGxpbmUpID0+IHtcbiAgICAgIC8vIEZpbmQgYWxsIGltYWdlLXJlZiBtYXRjaGVzIGFuZCByZWJ1aWxkIGxpbmVcbiAgICAgIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgbGV0IGN1cnNvciA9IDA7XG4gICAgICBjb25zdCBjb21iaW5lZCA9IC8hXFxbXFxbKFteXFxdXSspXFxdXFxdfCFcXFsoW15cXF1dKilcXF1cXCgoW14pXSspXFwpL2c7XG4gICAgICBsZXQgbTogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcbiAgICAgIHdoaWxlICgobSA9IGNvbWJpbmVkLmV4ZWMobGluZSkpICE9PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IGJlZm9yZSA9IGxpbmUuc2xpY2UoY3Vyc29yLCBtLmluZGV4KTtcbiAgICAgICAgaWYgKGJlZm9yZSkgcGFydHMucHVzaChlc2NhcGVIdG1sKGJlZm9yZSkpO1xuICAgICAgICBjb25zdCByYXcgPSBtWzBdO1xuICAgICAgICBjb25zdCBhbHQgPSAobVsyXSA/PyBtWzFdPy5zcGxpdCgnfCcpWzFdID8/ICcnKS50cmltKCk7XG4gICAgICAgIGNvbnN0IGZpbmFsU3JjID0gcmVzb2x2ZWQuZ2V0KHJhdykgPz8gJyc7XG4gICAgICAgIHBhcnRzLnB1c2goYDxpbWcgc3JjPVwiJHtlc2NhcGVBdHRyKGZpbmFsU3JjKX1cIiBhbHQ9XCIke2VzY2FwZUF0dHIoYWx0KX1cIj5gKTtcbiAgICAgICAgY3Vyc29yID0gbS5pbmRleCArIHJhdy5sZW5ndGg7XG4gICAgICB9XG4gICAgICBjb25zdCByZXN0ID0gbGluZS5zbGljZShjdXJzb3IpO1xuICAgICAgaWYgKHJlc3QpIHBhcnRzLnB1c2goZXNjYXBlSHRtbChyZXN0KSk7XG4gICAgICByZXR1cm4gcGFydHMuam9pbignJyk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYDxkaXY+JHtodG1sTGluZXMuam9pbignPGJyPicpfTwvZGl2PmA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVJbWFnZVNyYyhzcmM6IHN0cmluZywgc291cmNlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgLy8gQWxyZWFkeSBpbmxpbmUgLyByZW1vdGVcbiAgICBpZiAoc3JjLnN0YXJ0c1dpdGgoJ2RhdGE6JykpIHJldHVybiBzcmM7XG4gICAgaWYgKC9eaHR0cHM/OlxcL1xcLy9pLnRlc3Qoc3JjKSkge1xuICAgICAgY29uc3QgZGF0YVVybCA9IGF3YWl0IGZldGNoQXNEYXRhVXJsKHNyYyk7XG4gICAgICByZXR1cm4gZGF0YVVybCA/PyBzcmM7XG4gICAgfVxuXG4gICAgLy8gVmF1bHQtcmVzb2x2ZWQgcGF0aFxuICAgIGNvbnN0IGxpbmtwYXRoID0gZGVjb2RlVVJJQ29tcG9uZW50KHNyYykucmVwbGFjZSgvXlxcLysvLCAnJyk7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QobGlua3BhdGgsIHNvdXJjZVBhdGgpO1xuICAgIGlmICghZmlsZSB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybiBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIucmVhZEJpbmFyeShmaWxlLnBhdGgpO1xuICAgICAgaWYgKGJ1Zi5ieXRlTGVuZ3RoID4gTUFYX0VNQkVEX0JZVEVTKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYFNraXBwZWQgZW1iZWRkaW5nICh0b28gbGFyZ2UpOiAke2ZpbGUubmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICBjb25zdCBleHQgPSBmaWxlLmV4dGVuc2lvbi50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgbWltZSA9IElNQUdFX0VYVF9NSU1FW2V4dF0gPz8gJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSc7XG4gICAgICByZXR1cm4gYGRhdGE6JHttaW1lfTtiYXNlNjQsJHthcnJheUJ1ZmZlclRvQmFzZTY0KGJ1Zil9YDtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byByZWFkIHZhdWx0IGltYWdlJywgZXJyKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tIEhlbHBlcnMgLS0tLVxuXG5mdW5jdGlvbiBoYXNJbWFnZVJlZih0ZXh0OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC8hXFxbXFxbW15cXF1dK1xcXVxcXXwhXFxbW15cXF1dKlxcXVxcKFteKV0rXFwpLy50ZXN0KHRleHQpO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVIdG1sKHM6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKTtcbn1cblxuZnVuY3Rpb24gZXNjYXBlQXR0cihzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc1xuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpO1xufVxuXG5mdW5jdGlvbiBhcnJheUJ1ZmZlclRvQmFzZTY0KGJ1ZjogQXJyYXlCdWZmZXIpOiBzdHJpbmcge1xuICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJ1Zik7XG4gIGNvbnN0IENIVU5LID0gMHg4MDAwO1xuICBsZXQgYmluYXJ5ID0gJyc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IENIVU5LKSB7XG4gICAgY29uc3Qgc3ViID0gYnl0ZXMuc3ViYXJyYXkoaSwgaSArIENIVU5LKTtcbiAgICBiaW5hcnkgKz0gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBBcnJheS5mcm9tKHN1YikpO1xuICB9XG4gIHJldHVybiBidG9hKGJpbmFyeSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQXNEYXRhVXJsKHVybDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2godXJsKTtcbiAgICBpZiAoIXJlcy5vaykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgYmxvYiA9IGF3YWl0IHJlcy5ibG9iKCk7XG4gICAgaWYgKGJsb2Iuc2l6ZSA+IE1BWF9FTUJFRF9CWVRFUykgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgYnVmID0gYXdhaXQgYmxvYi5hcnJheUJ1ZmZlcigpO1xuICAgIGNvbnN0IG1pbWUgPSBibG9iLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSc7XG4gICAgcmV0dXJuIGBkYXRhOiR7bWltZX07YmFzZTY0LCR7YXJyYXlCdWZmZXJUb0Jhc2U2NChidWYpfWA7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxzQkFBZ0U7QUFFaEUsSUFBTSxlQUFlO0FBQ3JCLElBQU0sY0FBYztBQUNwQixJQUFNLGVBQWU7QUFDckIsSUFBTSxxQkFBcUI7QUFDM0IsSUFBTSxpQkFBaUI7QUFDdkIsSUFBTSxrQkFBa0IsSUFBSSxPQUFPO0FBRW5DLElBQU0saUJBQXlDO0FBQUEsRUFDN0MsS0FBSztBQUFBLEVBQ0wsS0FBSztBQUFBLEVBQ0wsTUFBTTtBQUFBLEVBQ04sS0FBSztBQUFBLEVBQ0wsTUFBTTtBQUFBLEVBQ04sS0FBSztBQUFBLEVBQ0wsS0FBSztBQUFBLEVBQ0wsTUFBTTtBQUNSO0FBV0EsSUFBcUIscUJBQXJCLGNBQWdELHVCQUFPO0FBQUEsRUFBdkQ7QUFBQTtBQUNFLFNBQVEsWUFBbUM7QUFDM0MsU0FBUSxVQUFtQixFQUFFLFVBQVUsR0FBRyxXQUFXLEdBQUcsV0FBVyxHQUFHLFlBQVksR0FBRyxNQUFNLEdBQUcsS0FBSyxFQUFFO0FBQ3JHLFNBQVEsZUFBNkI7QUFDckMsU0FBUSx5QkFBaUQ7QUFD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
