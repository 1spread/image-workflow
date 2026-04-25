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
    overlay.addClass("image-workflow-overlay");
    this.overlayEl = overlay;
    const imgView = document.createElement("img");
    imgView.addClass("image-workflow-view");
    imgView.src = src;
    const btnGroup = document.createElement("div");
    btnGroup.addClass("image-workflow-btn-group");
    const copyBtn = document.createElement("button");
    copyBtn.addClass("image-workflow-btn");
    copyBtn.textContent = "Copy";
    const downloadBtn = document.createElement("button");
    downloadBtn.addClass("image-workflow-btn");
    downloadBtn.textContent = "Download";
    const copyPathBtn = document.createElement("button");
    copyPathBtn.addClass("image-workflow-btn");
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
    inlineStyleForExternalPaste(container);
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
var CALLOUT_COLORS = {
  note: { border: "#448aff", bg: "#e3f2fd", title: "#1565c0" },
  abstract: { border: "#00bcd4", bg: "#e0f7fa", title: "#00838f" },
  summary: { border: "#00bcd4", bg: "#e0f7fa", title: "#00838f" },
  tldr: { border: "#00bcd4", bg: "#e0f7fa", title: "#00838f" },
  info: { border: "#00b8d4", bg: "#e1f5fe", title: "#0277bd" },
  todo: { border: "#00b0ff", bg: "#e1f5fe", title: "#0277bd" },
  tip: { border: "#00bfa5", bg: "#e0f2f1", title: "#00695c" },
  hint: { border: "#00bfa5", bg: "#e0f2f1", title: "#00695c" },
  important: { border: "#00bfa5", bg: "#e0f2f1", title: "#00695c" },
  success: { border: "#00c853", bg: "#e8f5e9", title: "#2e7d32" },
  check: { border: "#00c853", bg: "#e8f5e9", title: "#2e7d32" },
  done: { border: "#00c853", bg: "#e8f5e9", title: "#2e7d32" },
  question: { border: "#64dd17", bg: "#f1f8e9", title: "#558b2f" },
  help: { border: "#64dd17", bg: "#f1f8e9", title: "#558b2f" },
  faq: { border: "#64dd17", bg: "#f1f8e9", title: "#558b2f" },
  warning: { border: "#ff9100", bg: "#fff3e0", title: "#e65100" },
  caution: { border: "#ff9100", bg: "#fff3e0", title: "#e65100" },
  attention: { border: "#ff9100", bg: "#fff3e0", title: "#e65100" },
  failure: { border: "#ff5252", bg: "#ffebee", title: "#c62828" },
  fail: { border: "#ff5252", bg: "#ffebee", title: "#c62828" },
  missing: { border: "#ff5252", bg: "#ffebee", title: "#c62828" },
  danger: { border: "#ff1744", bg: "#ffebee", title: "#b71c1c" },
  error: { border: "#ff1744", bg: "#ffebee", title: "#b71c1c" },
  bug: { border: "#f50057", bg: "#fce4ec", title: "#ad1457" },
  example: { border: "#7c4dff", bg: "#ede7f6", title: "#4527a0" },
  quote: { border: "#9e9e9e", bg: "#fafafa", title: "#424242" },
  cite: { border: "#9e9e9e", bg: "#fafafa", title: "#424242" }
};
function setStyle(el, css) {
  var _a;
  const existing = (_a = el.getAttribute("style")) != null ? _a : "";
  el.setAttribute("style", existing ? `${existing}; ${css}` : css);
}
function inlineStyleForExternalPaste(root) {
  root.querySelectorAll("pre").forEach((pre) => {
    setStyle(
      pre,
      'background:#f6f8fa; border:1px solid #e1e4e8; border-radius:6px; padding:12px 16px; margin:8px 0; font-family:Menlo, Consolas, "Courier New", monospace; font-size:13px; line-height:1.45; white-space:pre-wrap; overflow-x:auto; color:#24292e'
    );
  });
  root.querySelectorAll("code").forEach((code) => {
    if (code.closest("pre"))
      return;
    setStyle(
      code,
      'background:#f6f8fa; padding:2px 6px; border-radius:4px; font-family:Menlo, Consolas, "Courier New", monospace; font-size:0.9em; color:#d6336c'
    );
  });
  root.querySelectorAll("mark").forEach((mk) => {
    setStyle(mk, "background:#fff59d; padding:0 2px");
  });
  root.querySelectorAll("blockquote").forEach((bq) => {
    if (bq.classList.contains("callout"))
      return;
    setStyle(
      bq,
      "border-left:4px solid #dfe2e5; margin:8px 0; padding:4px 12px; color:#586069; background:#fafbfc"
    );
  });
  root.querySelectorAll(".callout").forEach((co) => {
    var _a;
    const type = (co.getAttribute("data-callout") || "note").toLowerCase();
    const colors = (_a = CALLOUT_COLORS[type]) != null ? _a : CALLOUT_COLORS.note;
    setStyle(
      co,
      `border-left:4px solid ${colors.border}; background:${colors.bg}; border-radius:4px; padding:10px 14px; margin:8px 0; color:#24292e`
    );
    co.querySelectorAll(".callout-title").forEach((t) => {
      setStyle(t, `color:${colors.title}; font-weight:600; margin-bottom:4px; display:block`);
    });
    co.querySelectorAll(".callout-icon, .callout-fold").forEach((el) => el.remove());
  });
  root.querySelectorAll("table").forEach((tbl) => {
    setStyle(
      tbl,
      "border-collapse:collapse; margin:8px 0; border:1px solid #d0d7de"
    );
  });
  root.querySelectorAll("th, td").forEach((cell) => {
    setStyle(cell, "border:1px solid #d0d7de; padding:6px 12px");
  });
  root.querySelectorAll("th").forEach((th) => {
    setStyle(th, "background:#f6f8fa; font-weight:600");
  });
  root.querySelectorAll("hr").forEach((hr) => {
    setStyle(hr, "border:0; border-top:1px solid #d0d7de; margin:16px 0");
  });
  const headingSize = { H1: "1.8em", H2: "1.5em", H3: "1.25em", H4: "1.1em", H5: "1em", H6: "0.9em" };
  root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    var _a;
    const size = (_a = headingSize[h.tagName]) != null ? _a : "1em";
    setStyle(h, `font-weight:700; margin:0.6em 0 0.3em; font-size:${size}`);
  });
  root.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    const span = document.createElement("span");
    span.textContent = cb.checked ? "\u2611 " : "\u2610 ";
    setStyle(span, "font-family:monospace");
    cb.replaceWith(span);
  });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgRWRpdG9yLCBGaWxlU3lzdGVtQWRhcHRlciwgTWFya2Rvd25SZW5kZXJlciwgTm90aWNlLCBQbHVnaW4sIFNjb3BlLCBURmlsZSB9IGZyb20gJ29ic2lkaWFuJztcblxuY29uc3QgSU1HX1NFTEVDVE9SID0gYC53b3Jrc3BhY2UtbGVhZi1jb250ZW50W2RhdGEtdHlwZT0nbWFya2Rvd24nXSBpbWc6bm90KGEgaW1nKSwgLndvcmtzcGFjZS1sZWFmLWNvbnRlbnRbZGF0YS10eXBlPSdpbWFnZSddIGltZ2A7XG5jb25zdCBaT09NX0ZBQ1RPUiA9IDAuODtcbmNvbnN0IElNR19WSUVXX01JTiA9IDMwO1xuY29uc3QgQlVUVE9OX0FSRUFfSEVJR0hUID0gMTAwOyAvLyBib3R0b20gYnV0dG9uIGdyb3VwIGNsZWFyYW5jZVxuY29uc3QgTUFYX0NBTlZBU19ESU0gPSA4MTkyO1xuY29uc3QgTUFYX0VNQkVEX0JZVEVTID0gNSAqIDEwMjQgKiAxMDI0OyAvLyA1TUIgcGVyIGltYWdlXG5cbmNvbnN0IElNQUdFX0VYVF9NSU1FOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICBwbmc6ICdpbWFnZS9wbmcnLFxuICBqcGc6ICdpbWFnZS9qcGVnJyxcbiAganBlZzogJ2ltYWdlL2pwZWcnLFxuICBnaWY6ICdpbWFnZS9naWYnLFxuICB3ZWJwOiAnaW1hZ2Uvd2VicCcsXG4gIHN2ZzogJ2ltYWdlL3N2Zyt4bWwnLFxuICBibXA6ICdpbWFnZS9ibXAnLFxuICBhdmlmOiAnaW1hZ2UvYXZpZicsXG59O1xuXG5pbnRlcmZhY2UgSW1nSW5mbyB7XG4gIGN1cldpZHRoOiBudW1iZXI7XG4gIGN1ckhlaWdodDogbnVtYmVyO1xuICByZWFsV2lkdGg6IG51bWJlcjtcbiAgcmVhbEhlaWdodDogbnVtYmVyO1xuICBsZWZ0OiBudW1iZXI7XG4gIHRvcDogbnVtYmVyO1xufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbWFnZUVubGFyZ2VQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBwcml2YXRlIG92ZXJsYXlFbDogSFRNTERpdkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBpbWdJbmZvOiBJbWdJbmZvID0geyBjdXJXaWR0aDogMCwgY3VySGVpZ2h0OiAwLCByZWFsV2lkdGg6IDAsIHJlYWxIZWlnaHQ6IDAsIGxlZnQ6IDAsIHRvcDogMCB9O1xuICBwcml2YXRlIG92ZXJsYXlTY29wZTogU2NvcGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBvdmVybGF5QWJvcnRDb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByYWZJZDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG5cbiAgcHJpdmF0ZSBoYW5kbGVJbWFnZUNsaWNrID0gKGV2dDogTW91c2VFdmVudCkgPT4ge1xuICAgIGNvbnN0IHRhcmdldCA9IGV2dC50YXJnZXQgYXMgSFRNTEVsZW1lbnQ7XG4gICAgY29uc3QgaW1nID0gdGFyZ2V0IGluc3RhbmNlb2YgSFRNTEltYWdlRWxlbWVudFxuICAgICAgPyB0YXJnZXRcbiAgICAgIDogdGFyZ2V0LmNsb3Nlc3QoJ2ltZycpO1xuICAgIGlmICghaW1nIHx8ICEoaW1nIGluc3RhbmNlb2YgSFRNTEltYWdlRWxlbWVudCkpIHJldHVybjtcbiAgICBpZiAoIWltZy5tYXRjaGVzKElNR19TRUxFQ1RPUikpIHJldHVybjtcbiAgICBpZiAodGhpcy5vdmVybGF5RWwpIHJldHVybjtcbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7IC8vIE9ic2lkaWFuIFx1NTA3NFx1MzA2RVx1MzBDRlx1MzBGM1x1MzBDOVx1MzBFOVx1MzA0Q1x1NzUzQlx1NTBDRlx1MzA5Mlx1NTIyNVx1MzBEQVx1MzBBNFx1MzBGM1x1MzA2N1x1OTU4Qlx1MzA0Rlx1MzA2RVx1MzA5Mlx1OTYzMlx1MzA1MFxuICAgIHRoaXMub3Blbk92ZXJsYXkoaW1nLnNyYyk7XG4gIH07XG5cbiAgcHJpdmF0ZSBoYW5kbGVQYXN0ZSA9IChldnQ6IENsaXBib2FyZEV2ZW50KSA9PiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gZXZ0LnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgaWYgKCF0YXJnZXQgfHwgIXRhcmdldC5jbG9zZXN0KGAud29ya3NwYWNlLWxlYWYtY29udGVudFtkYXRhLXR5cGU9J21hcmtkb3duJ11gKSkgcmV0dXJuO1xuXG4gICAgY29uc3QgZGF0YSA9IGV2dC5jbGlwYm9hcmREYXRhO1xuICAgIGlmICghZGF0YSkgcmV0dXJuO1xuICAgIGNvbnN0IGh0bWwgPSBkYXRhLmdldERhdGEoJ3RleHQvaHRtbCcpO1xuICAgIGNvbnN0IHRleHQgPSBkYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKTtcbiAgICBpZiAoIWh0bWwgfHwgIXRleHQpIHJldHVybjtcblxuICAgIC8vIE9ubHkgb3ZlcnJpZGUgd2hlbiBIVE1MIGNhcnJpZXMgZGF0YTogaW1hZ2UgVVJMcyAoaS5lLiB3ZSBcdTIwMTQgb3IgYSBzaW1pbGFyIHRvb2wgXHUyMDE0XG4gICAgLy8gd3JvdGUgYSByaWNoIHZlcnNpb24pLiBGb3Igb3JkaW5hcnkgSFRNTCBwYXN0ZXMsIGxldCBPYnNpZGlhbiBoYW5kbGUgaXQgbm9ybWFsbHkuXG4gICAgaWYgKCEvPGltZ1xcYltePl0qXFxic3JjPVtcIiddZGF0YTppbWFnZVxcLy9pLnRlc3QoaHRtbCkpIHJldHVybjtcblxuICAgIGV2dC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIGV2dC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAvLyBJbnNlcnQgdGhlIHBsYWluLXRleHQgKG9yaWdpbmFsIG1hcmtkb3duKSB2ZXJzaW9uIGluc3RlYWQuXG4gICAgZG9jdW1lbnQuZXhlY0NvbW1hbmQoJ2luc2VydFRleHQnLCBmYWxzZSwgdGV4dCk7XG4gIH07XG5cbiAgcHJpdmF0ZSBoYW5kbGVDb3B5ID0gKGV2dDogQ2xpcGJvYXJkRXZlbnQpID0+IHtcbiAgICBjb25zdCB0YXJnZXQgPSBldnQudGFyZ2V0IGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICAvLyBPbmx5IGludGVyY2VwdCBjb3BpZXMgb3JpZ2luYXRpbmcgZnJvbSBhIG1hcmtkb3duIGxlYWZcbiAgICBpZiAoIXRhcmdldCB8fCAhdGFyZ2V0LmNsb3Nlc3QoYC53b3Jrc3BhY2UtbGVhZi1jb250ZW50W2RhdGEtdHlwZT0nbWFya2Rvd24nXWApKSByZXR1cm47XG5cbiAgICBjb25zdCBzZWxlY3Rpb24gPSB3aW5kb3cuZ2V0U2VsZWN0aW9uKCk7XG4gICAgY29uc3QgdGV4dCA9IHNlbGVjdGlvbj8udG9TdHJpbmcoKTtcbiAgICBpZiAoIXRleHQpIHJldHVybjtcblxuICAgIGlmICghaGFzSW1hZ2VSZWYodGV4dCkpIHJldHVybjtcblxuICAgIC8vIFdlIHdpbGwgaGFuZGxlIHRoaXMgY29weTogcHJldmVudCBkZWZhdWx0IGFuZCB3cml0ZSBhc3luY2hyb25vdXNseS5cbiAgICBldnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgdm9pZCB0aGlzLndyaXRlUmljaENsaXBib2FyZCh0ZXh0KTtcbiAgfTtcblxuICBvbmxvYWQoKSB7XG4gICAgLy8gY2FwdHVyZTogdHJ1ZSBcdTIwMTQgT2JzaWRpYW4vQ002IFx1MzA2RSBzdG9wUHJvcGFnYXRpb24gXHUzMDg4XHUzMDhBXHU1MTQ4XHUzMDZCXHU3NjdBXHU3MDZCXG4gICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KGRvY3VtZW50LCAnY2xpY2snLCB0aGlzLmhhbmRsZUltYWdlQ2xpY2ssIHRydWUpO1xuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgJ2NvcHknLCB0aGlzLmhhbmRsZUNvcHksIHRydWUpO1xuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgJ3Bhc3RlJywgdGhpcy5oYW5kbGVQYXN0ZSwgdHJ1ZSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdjb3B5LWFzLWh0bWwtd2l0aC1pbWFnZXMnLFxuICAgICAgbmFtZTogJ0NvcHkgc2VsZWN0aW9uIGFzIEhUTUwgd2l0aCBlbWJlZGRlZCBpbWFnZXMnLFxuICAgICAgZWRpdG9yQ2FsbGJhY2s6IChlZGl0b3I6IEVkaXRvcikgPT4ge1xuICAgICAgICB2b2lkIHRoaXMuY29weVNlbGVjdGlvbkFzUmljaEh0bWwoZWRpdG9yKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICBvbnVubG9hZCgpIHtcbiAgICB0aGlzLmNsb3NlT3ZlcmxheSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBvcGVuT3ZlcmxheShzcmM6IHN0cmluZykge1xuICAgIGlmICh0aGlzLm92ZXJsYXlFbCkgcmV0dXJuO1xuXG4gICAgY29uc3Qgb3ZlcmxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIG92ZXJsYXkuYWRkQ2xhc3MoJ2ltYWdlLXdvcmtmbG93LW92ZXJsYXknKTtcbiAgICB0aGlzLm92ZXJsYXlFbCA9IG92ZXJsYXk7XG5cbiAgICBjb25zdCBpbWdWaWV3ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW1nJyk7XG4gICAgaW1nVmlldy5hZGRDbGFzcygnaW1hZ2Utd29ya2Zsb3ctdmlldycpO1xuICAgIGltZ1ZpZXcuc3JjID0gc3JjO1xuXG4gICAgY29uc3QgYnRuR3JvdXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBidG5Hcm91cC5hZGRDbGFzcygnaW1hZ2Utd29ya2Zsb3ctYnRuLWdyb3VwJyk7XG5cbiAgICBjb25zdCBjb3B5QnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgY29weUJ0bi5hZGRDbGFzcygnaW1hZ2Utd29ya2Zsb3ctYnRuJyk7XG4gICAgY29weUJ0bi50ZXh0Q29udGVudCA9ICdDb3B5JztcblxuICAgIGNvbnN0IGRvd25sb2FkQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgZG93bmxvYWRCdG4uYWRkQ2xhc3MoJ2ltYWdlLXdvcmtmbG93LWJ0bicpO1xuICAgIGRvd25sb2FkQnRuLnRleHRDb250ZW50ID0gJ0Rvd25sb2FkJztcblxuICAgIGNvbnN0IGNvcHlQYXRoQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgY29weVBhdGhCdG4uYWRkQ2xhc3MoJ2ltYWdlLXdvcmtmbG93LWJ0bicpO1xuICAgIGNvcHlQYXRoQnRuLnRleHRDb250ZW50ID0gJ0NvcHkgUGF0aCc7XG5cbiAgICBidG5Hcm91cC5hcHBlbmRDaGlsZChjb3B5QnRuKTtcbiAgICBidG5Hcm91cC5hcHBlbmRDaGlsZChkb3dubG9hZEJ0bik7XG4gICAgYnRuR3JvdXAuYXBwZW5kQ2hpbGQoY29weVBhdGhCdG4pO1xuICAgIG92ZXJsYXkuYXBwZW5kQ2hpbGQoaW1nVmlldyk7XG4gICAgb3ZlcmxheS5hcHBlbmRDaGlsZChidG5Hcm91cCk7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChvdmVybGF5KTtcblxuICAgIGlmIChpbWdWaWV3LmNvbXBsZXRlICYmIGltZ1ZpZXcubmF0dXJhbFdpZHRoID4gMCkge1xuICAgICAgdGhpcy5jYWxjdWxhdGVGaXRTaXplKGltZ1ZpZXcpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpbWdWaWV3Lm9ubG9hZCA9ICgpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLm92ZXJsYXlFbCkgcmV0dXJuO1xuICAgICAgICB0aGlzLmNhbGN1bGF0ZUZpdFNpemUoaW1nVmlldyk7XG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgdGhpcy5vdmVybGF5QWJvcnRDb250cm9sbGVyID0gY29udHJvbGxlcjtcbiAgICBjb25zdCB7IHNpZ25hbCB9ID0gY29udHJvbGxlcjtcblxuICAgIGltZ1ZpZXcuYWRkRXZlbnRMaXN0ZW5lcignZHJhZ3N0YXJ0JywgKGUpID0+IGUucHJldmVudERlZmF1bHQoKSwgeyBzaWduYWwgfSk7XG5cbiAgICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcbiAgICAgIGlmIChlLnRhcmdldCA9PT0gb3ZlcmxheSkgdGhpcy5jbG9zZU92ZXJsYXkoKTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcblxuICAgIHRoaXMub3ZlcmxheVNjb3BlID0gbmV3IFNjb3BlKCk7XG4gICAgdGhpcy5vdmVybGF5U2NvcGUucmVnaXN0ZXIobnVsbCwgJ0VzY2FwZScsICgpID0+IHtcbiAgICAgIHRoaXMuY2xvc2VPdmVybGF5KCk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSk7XG4gICAgdGhpcy5vdmVybGF5U2NvcGUucmVnaXN0ZXIoWydNb2QnXSwgJ2MnLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvcHlJbWFnZVRvQ2xpcGJvYXJkKGltZ1ZpZXcpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0pO1xuICAgIHRoaXMub3ZlcmxheVNjb3BlLnJlZ2lzdGVyKFsnTW9kJywgJ1NoaWZ0J10sICdjJywgKCkgPT4ge1xuICAgICAgdGhpcy5jb3B5SW1hZ2VQYXRoKHNyYyk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSk7XG4gICAgdGhpcy5vdmVybGF5U2NvcGUucmVnaXN0ZXIoWydNb2QnXSwgJ3MnLCAoKSA9PiB7XG4gICAgICB0aGlzLmRvd25sb2FkSW1hZ2Uoc3JjKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9KTtcbiAgICB0aGlzLmFwcC5rZXltYXAucHVzaFNjb3BlKHRoaXMub3ZlcmxheVNjb3BlKTtcblxuICAgIGltZ1ZpZXcuYWRkRXZlbnRMaXN0ZW5lcignd2hlZWwnLCAoZSkgPT4ge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgY29uc3Qgem9vbUluID0gZS5kZWx0YVkgPCAwO1xuICAgICAgY29uc3QgcmF0aW8gPSB6b29tSW4gPyAwLjEgOiAtMC4xO1xuICAgICAgY29uc3QgcmVjdCA9IGltZ1ZpZXcuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBjb25zdCBvZmZzZXRYID0gZS5jbGllbnRYIC0gcmVjdC5sZWZ0O1xuICAgICAgY29uc3Qgb2Zmc2V0WSA9IGUuY2xpZW50WSAtIHJlY3QudG9wO1xuICAgICAgaWYgKHRoaXMucmFmSWQgIT09IG51bGwpIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmFmSWQpO1xuICAgICAgdGhpcy5yYWZJZCA9IHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiB7XG4gICAgICAgIHRoaXMucmFmSWQgPSBudWxsO1xuICAgICAgICB0aGlzLnpvb20ocmF0aW8sIHsgb2Zmc2V0WCwgb2Zmc2V0WSB9KTtcbiAgICAgICAgdGhpcy5hcHBseVRyYW5zZm9ybShpbWdWaWV3KTtcbiAgICAgIH0pO1xuICAgIH0sIHsgc2lnbmFsIH0pO1xuXG4gICAgY29weUJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XG4gICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5jb3B5SW1hZ2VUb0NsaXBib2FyZChpbWdWaWV3KTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcblxuICAgIGRvd25sb2FkQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcbiAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLmRvd25sb2FkSW1hZ2Uoc3JjKTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcblxuICAgIGNvcHlQYXRoQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcbiAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLmNvcHlJbWFnZVBhdGgoc3JjKTtcbiAgICB9LCB7IHNpZ25hbCB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY2FsY3VsYXRlRml0U2l6ZShpbWdWaWV3OiBIVE1MSW1hZ2VFbGVtZW50KSB7XG4gICAgY29uc3Qgd2luVyA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5jbGllbnRXaWR0aDtcbiAgICBjb25zdCB3aW5IID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudEhlaWdodCAtIEJVVFRPTl9BUkVBX0hFSUdIVDtcbiAgICBjb25zdCB6b29tVyA9IHdpblcgKiBaT09NX0ZBQ1RPUjtcbiAgICBjb25zdCB6b29tSCA9IHdpbkggKiBaT09NX0ZBQ1RPUjtcblxuICAgIGxldCB3ID0gaW1nVmlldy5uYXR1cmFsV2lkdGgsIGggPSBpbWdWaWV3Lm5hdHVyYWxIZWlnaHQ7XG4gICAgaWYgKGggPiB6b29tSCkge1xuICAgICAgaCA9IHpvb21IO1xuICAgICAgdyA9IGggLyBpbWdWaWV3Lm5hdHVyYWxIZWlnaHQgKiBpbWdWaWV3Lm5hdHVyYWxXaWR0aDtcbiAgICAgIGlmICh3ID4gem9vbVcpIHcgPSB6b29tVztcbiAgICB9IGVsc2UgaWYgKHcgPiB6b29tVykge1xuICAgICAgdyA9IHpvb21XO1xuICAgIH1cbiAgICBoID0gdyAqIGltZ1ZpZXcubmF0dXJhbEhlaWdodCAvIGltZ1ZpZXcubmF0dXJhbFdpZHRoO1xuXG4gICAgdGhpcy5pbWdJbmZvID0ge1xuICAgICAgY3VyV2lkdGg6IHcsXG4gICAgICBjdXJIZWlnaHQ6IGgsXG4gICAgICByZWFsV2lkdGg6IGltZ1ZpZXcubmF0dXJhbFdpZHRoLFxuICAgICAgcmVhbEhlaWdodDogaW1nVmlldy5uYXR1cmFsSGVpZ2h0LFxuICAgICAgbGVmdDogKHdpblcgLSB3KSAvIDIsXG4gICAgICB0b3A6ICh3aW5IIC0gaCkgLyAyLFxuICAgIH07XG4gICAgdGhpcy5hcHBseVRyYW5zZm9ybShpbWdWaWV3KTtcbiAgfVxuXG4gIHByaXZhdGUgem9vbShyYXRpbzogbnVtYmVyLCBvZmZzZXQ6IHsgb2Zmc2V0WDogbnVtYmVyOyBvZmZzZXRZOiBudW1iZXIgfSkge1xuICAgIGNvbnN0IGluZm8gPSB0aGlzLmltZ0luZm87XG4gICAgY29uc3Qgem9vbUluID0gcmF0aW8gPiAwO1xuICAgIGNvbnN0IG11bHRpcGxpZXIgPSB6b29tSW4gPyAxICsgcmF0aW8gOiAxIC8gKDEgLSByYXRpbyk7XG4gICAgbGV0IHpvb21SYXRpbyA9IGluZm8uY3VyV2lkdGggKiBtdWx0aXBsaWVyIC8gaW5mby5yZWFsV2lkdGg7XG5cbiAgICBjb25zdCBjdXJSYXRpbyA9IGluZm8uY3VyV2lkdGggLyBpbmZvLnJlYWxXaWR0aDtcbiAgICBpZiAoKGN1clJhdGlvIDwgMSAmJiB6b29tUmF0aW8gPiAxKSB8fCAoY3VyUmF0aW8gPiAxICYmIHpvb21SYXRpbyA8IDEpKSB7XG4gICAgICB6b29tUmF0aW8gPSAxO1xuICAgICAgY29uc3Qgc25hcE11bHRpcGxpZXIgPSAxIC8gY3VyUmF0aW87XG4gICAgICBpbmZvLmxlZnQgKz0gb2Zmc2V0Lm9mZnNldFggKiAoMSAtIHNuYXBNdWx0aXBsaWVyKTtcbiAgICAgIGluZm8udG9wICs9IG9mZnNldC5vZmZzZXRZICogKDEgLSBzbmFwTXVsdGlwbGllcik7XG4gICAgICBpbmZvLmN1cldpZHRoID0gaW5mby5yZWFsV2lkdGg7XG4gICAgICBpbmZvLmN1ckhlaWdodCA9IGluZm8ucmVhbEhlaWdodDtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsZXQgbmV3VyA9IGluZm8ucmVhbFdpZHRoICogem9vbVJhdGlvO1xuICAgIGxldCBuZXdIID0gaW5mby5yZWFsSGVpZ2h0ICogem9vbVJhdGlvO1xuXG4gICAgaWYgKG5ld1cgPCBJTUdfVklFV19NSU4gfHwgbmV3SCA8IElNR19WSUVXX01JTikge1xuICAgICAgaWYgKG5ld1cgPCBJTUdfVklFV19NSU4pIHtcbiAgICAgICAgbmV3VyA9IElNR19WSUVXX01JTjtcbiAgICAgICAgbmV3SCA9IG5ld1cgKiBpbmZvLnJlYWxIZWlnaHQgLyBpbmZvLnJlYWxXaWR0aDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5ld0ggPSBJTUdfVklFV19NSU47XG4gICAgICAgIG5ld1cgPSBuZXdIICogaW5mby5yZWFsV2lkdGggLyBpbmZvLnJlYWxIZWlnaHQ7XG4gICAgICB9XG4gICAgICBpbmZvLmN1cldpZHRoID0gbmV3VztcbiAgICAgIGluZm8uY3VySGVpZ2h0ID0gbmV3SDtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpbmZvLmxlZnQgKz0gb2Zmc2V0Lm9mZnNldFggKiAoMSAtIG11bHRpcGxpZXIpO1xuICAgIGluZm8udG9wICs9IG9mZnNldC5vZmZzZXRZICogKDEgLSBtdWx0aXBsaWVyKTtcbiAgICBpbmZvLmN1cldpZHRoID0gbmV3VztcbiAgICBpbmZvLmN1ckhlaWdodCA9IG5ld0g7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5VHJhbnNmb3JtKGltZ1ZpZXc6IEhUTUxJbWFnZUVsZW1lbnQpIHtcbiAgICBjb25zdCBpbmZvID0gdGhpcy5pbWdJbmZvO1xuICAgIGltZ1ZpZXcuc3R5bGUud2lkdGggPSBgJHtpbmZvLmN1cldpZHRofXB4YDtcbiAgICBpbWdWaWV3LnN0eWxlLmhlaWdodCA9IGAke2luZm8uY3VySGVpZ2h0fXB4YDtcbiAgICBpbWdWaWV3LnN0eWxlLnRyYW5zZm9ybSA9IGB0cmFuc2xhdGUoJHtpbmZvLmxlZnR9cHgsICR7aW5mby50b3B9cHgpYDtcbiAgfVxuXG4gIHByaXZhdGUgc3JjVG9WYXVsdFBhdGgoc3JjOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGxldCBwYXRoID0gc3JjO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHNyYyk7XG4gICAgICBjb25zdCBkZWNvZGVkUGF0aCA9IGRlY29kZVVSSUNvbXBvbmVudCh1cmwucGF0aG5hbWUpO1xuICAgICAgY29uc3QgdmF1bHRCYXNlUGF0aCA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgaW5zdGFuY2VvZiBGaWxlU3lzdGVtQWRhcHRlclxuICAgICAgICA/IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZ2V0QmFzZVBhdGgoKVxuICAgICAgICA6IG51bGw7XG4gICAgICBpZiAodmF1bHRCYXNlUGF0aCAmJiBkZWNvZGVkUGF0aC5pbmNsdWRlcyh2YXVsdEJhc2VQYXRoKSkge1xuICAgICAgICBjb25zdCBpZHggPSBkZWNvZGVkUGF0aC5pbmRleE9mKHZhdWx0QmFzZVBhdGgpO1xuICAgICAgICBwYXRoID0gZGVjb2RlZFBhdGguc3Vic3RyaW5nKGlkeCArIHZhdWx0QmFzZVBhdGgubGVuZ3RoKTtcbiAgICAgICAgaWYgKHBhdGguc3RhcnRzV2l0aCgnLycpKSBwYXRoID0gcGF0aC5zdWJzdHJpbmcoMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXRoID0gZGVjb2RlZFBhdGg7XG4gICAgICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoJy8nKSkgcGF0aCA9IHBhdGguc3Vic3RyaW5nKDEpO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gbm90IGEgdmFsaWQgVVJMIFx1MjAxNCB1c2UgYXMtaXNcbiAgICB9XG4gICAgcmV0dXJuIHBhdGg7XG4gIH1cblxuICBwcml2YXRlIGNvcHlJbWFnZVBhdGgoc3JjOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBwYXRoID0gdGhpcy5zcmNUb1ZhdWx0UGF0aChzcmMpO1xuICAgIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHBhdGgpLnRoZW4oXG4gICAgICAoKSA9PiBuZXcgTm90aWNlKCdQYXRoIGNvcGllZDogJyArIHBhdGgpLFxuICAgICAgKCkgPT4gbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHkgcGF0aCcpXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZG93bmxvYWRJbWFnZShzcmM6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChzcmMpO1xuICAgICAgaWYgKCFyZXMub2spIHRocm93IG5ldyBFcnJvcignZmV0Y2ggZmFpbGVkJyk7XG4gICAgICBjb25zdCBibG9iID0gYXdhaXQgcmVzLmJsb2IoKTtcbiAgICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XG4gICAgICBjb25zdCBwYXRoID0gdGhpcy5zcmNUb1ZhdWx0UGF0aChzcmMpO1xuICAgICAgY29uc3QgZmlsZW5hbWUgPSBwYXRoLnNwbGl0KCcvJykucG9wKCkgfHwgJ2ltYWdlJztcbiAgICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgICBhLmhyZWYgPSB1cmw7XG4gICAgICBhLmRvd25sb2FkID0gZmlsZW5hbWU7XG4gICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGEpO1xuICAgICAgYS5jbGljaygpO1xuICAgICAgYS5yZW1vdmUoKTtcbiAgICAgIC8vIFJldm9rZSBhZnRlciBhIHRpY2sgc28gdGhlIGRvd25sb2FkIGhhcyB0aW1lIHRvIHN0YXJ0XG4gICAgICBzZXRUaW1lb3V0KCgpID0+IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKSwgMTAwMCk7XG4gICAgICBuZXcgTm90aWNlKCdEb3dubG9hZGVkOiAnICsgZmlsZW5hbWUpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcihlcnIpO1xuICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGRvd25sb2FkJyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjb3B5SW1hZ2VUb0NsaXBib2FyZChpbWdWaWV3OiBIVE1MSW1hZ2VFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgaW1hZ2UgPSBuZXcgSW1hZ2UoKTtcbiAgICBjb25zdCBpc0ZpbGVVcmwgPSBpbWdWaWV3LnNyYy5zdGFydHNXaXRoKCdmaWxlOicpO1xuICAgIGlmICghaXNGaWxlVXJsKSB7XG4gICAgICBpbWFnZS5jcm9zc09yaWdpbiA9ICdhbm9ueW1vdXMnO1xuICAgIH1cbiAgICBpbWFnZS5zcmMgPSBpbWdWaWV3LnNyYztcbiAgICBpbWFnZS5vbmxvYWQgPSAoKSA9PiB7XG4gICAgICBjb25zdCBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICAgIGxldCB3ID0gaW1hZ2UubmF0dXJhbFdpZHRoO1xuICAgICAgbGV0IGggPSBpbWFnZS5uYXR1cmFsSGVpZ2h0O1xuICAgICAgaWYgKHcgPiBNQVhfQ0FOVkFTX0RJTSB8fCBoID4gTUFYX0NBTlZBU19ESU0pIHtcbiAgICAgICAgY29uc3Qgc2NhbGUgPSBNYXRoLm1pbihNQVhfQ0FOVkFTX0RJTSAvIHcsIE1BWF9DQU5WQVNfRElNIC8gaCk7XG4gICAgICAgIHcgPSBNYXRoLmZsb29yKHcgKiBzY2FsZSk7XG4gICAgICAgIGggPSBNYXRoLmZsb29yKGggKiBzY2FsZSk7XG4gICAgICB9XG4gICAgICBjYW52YXMud2lkdGggPSB3O1xuICAgICAgY2FudmFzLmhlaWdodCA9IGg7XG4gICAgICBjb25zdCBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICAgIGlmICghY3R4KSByZXR1cm47XG4gICAgICBjdHguZmlsbFN0eWxlID0gJyNmZmYnO1xuICAgICAgY3R4LmZpbGxSZWN0KDAsIDAsIGNhbnZhcy53aWR0aCwgY2FudmFzLmhlaWdodCk7XG4gICAgICBjdHguZHJhd0ltYWdlKGltYWdlLCAwLCAwLCB3LCBoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNhbnZhcy50b0Jsb2IoYXN5bmMgKGJsb2IpID0+IHtcbiAgICAgICAgICBjYW52YXMud2lkdGggPSAwO1xuICAgICAgICAgIGlmICghYmxvYikge1xuICAgICAgICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHkgaW1hZ2UnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGUoW1xuICAgICAgICAgICAgICBuZXcgQ2xpcGJvYXJkSXRlbSh7ICdpbWFnZS9wbmcnOiBibG9iIH0pLFxuICAgICAgICAgICAgXSk7XG4gICAgICAgICAgICBuZXcgTm90aWNlKCdJbWFnZSBjb3BpZWQnKTtcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoJ0ZhaWxlZCB0byBjb3B5IGltYWdlJyk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gY29weSBpbWFnZScpO1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICB9XG4gICAgfTtcbiAgICBpbWFnZS5vbmVycm9yID0gKCkgPT4ge1xuICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHkgaW1hZ2UnKTtcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjbG9zZU92ZXJsYXkoKSB7XG4gICAgaWYgKHRoaXMucmFmSWQgIT09IG51bGwpIHtcbiAgICAgIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmFmSWQpO1xuICAgICAgdGhpcy5yYWZJZCA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0aGlzLm92ZXJsYXlBYm9ydENvbnRyb2xsZXIpIHtcbiAgICAgIHRoaXMub3ZlcmxheUFib3J0Q29udHJvbGxlci5hYm9ydCgpO1xuICAgICAgdGhpcy5vdmVybGF5QWJvcnRDb250cm9sbGVyID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMub3ZlcmxheVNjb3BlKSB7XG4gICAgICB0aGlzLmFwcC5rZXltYXAucG9wU2NvcGUodGhpcy5vdmVybGF5U2NvcGUpO1xuICAgICAgdGhpcy5vdmVybGF5U2NvcGUgPSBudWxsO1xuICAgIH1cbiAgICBpZiAodGhpcy5vdmVybGF5RWwpIHtcbiAgICAgIHRoaXMub3ZlcmxheUVsLnJlbW92ZSgpO1xuICAgICAgdGhpcy5vdmVybGF5RWwgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gQ29tbWFuZDogQ29weSBzZWxlY3Rpb24gYXMgSFRNTCB3aXRoIGVtYmVkZGVkIGltYWdlcyAoT2JzaWRpYW4tcmVuZGVyZWQpIC0tLS1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlTZWxlY3Rpb25Bc1JpY2hIdG1sKGVkaXRvcjogRWRpdG9yKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc2VsZWN0aW9uID0gZWRpdG9yLmdldFNlbGVjdGlvbigpIHx8IGVkaXRvci5nZXRWYWx1ZSgpO1xuICAgIGlmICghc2VsZWN0aW9uKSB7XG4gICAgICBuZXcgTm90aWNlKCdOb3RoaW5nIHNlbGVjdGVkJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHNvdXJjZVBhdGggPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpPy5wYXRoID8/ICcnO1xuXG4gICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IE1hcmtkb3duUmVuZGVyZXIucmVuZGVyKHRoaXMuYXBwLCBzZWxlY3Rpb24sIGNvbnRhaW5lciwgc291cmNlUGF0aCwgdGhpcyk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdNYXJrZG93blJlbmRlcmVyIGZhaWxlZCcsIGVycik7XG4gICAgICBuZXcgTm90aWNlKCdGYWlsZWQgdG8gcmVuZGVyIG1hcmtkb3duJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gU3RyaXAgT2JzaWRpYW4taW50ZXJuYWwgVUkgZWxlbWVudHMgdGhhdCBzaG91bGRuJ3QgYmUgaW4gY2xpcGJvYXJkIEhUTUxcbiAgICBjb250YWluZXIucXVlcnlTZWxlY3RvckFsbCgnLmNvcHktY29kZS1idXR0b24sIC5mcm9udG1hdHRlciwgLmZyb250bWF0dGVyLWNvbnRhaW5lciwgLmVkaXQtYmxvY2stYnV0dG9uJykuZm9yRWFjaCgoZWwpID0+IGVsLnJlbW92ZSgpKTtcblxuICAgIC8vIEdvb2dsZSBEb2NzIC8gR21haWwgc3RyaXAgQ1NTIGNsYXNzZXMgXHUyMDE0IGFwcGx5IGlubGluZSBzdHlsZXMgZm9yIGNvZGUsIGNhbGxvdXRzLFxuICAgIC8vIGhpZ2hsaWdodHMsIGJsb2NrcXVvdGVzLCB0YWJsZXMgc28gZm9ybWF0dGluZyBzdXJ2aXZlcyB0aGUgcGFzdGUuXG4gICAgaW5saW5lU3R5bGVGb3JFeHRlcm5hbFBhc3RlKGNvbnRhaW5lcik7XG5cbiAgICBjb25zdCBpbWdzID0gQXJyYXkuZnJvbShjb250YWluZXIucXVlcnlTZWxlY3RvckFsbCgnaW1nJykpO1xuICAgIGF3YWl0IFByb21pc2UuYWxsKGltZ3MubWFwKGFzeW5jIChpbWcpID0+IHtcbiAgICAgIGNvbnN0IHNyYyA9IGltZy5nZXRBdHRyaWJ1dGUoJ3NyYycpO1xuICAgICAgaWYgKCFzcmMgfHwgc3JjLnN0YXJ0c1dpdGgoJ2RhdGE6JykpIHJldHVybjtcbiAgICAgIGNvbnN0IGRhdGFVcmwgPSBhd2FpdCBmZXRjaEFzRGF0YVVybChzcmMpO1xuICAgICAgaWYgKGRhdGFVcmwpIHtcbiAgICAgICAgaW1nLnNldEF0dHJpYnV0ZSgnc3JjJywgZGF0YVVybCk7XG4gICAgICAgIGltZy5yZW1vdmVBdHRyaWJ1dGUoJ3NyY3NldCcpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV3IE5vdGljZShgQ291bGQgbm90IGVtYmVkIGltYWdlOiAke3NyYy5zcGxpdCgnLycpLnBvcCgpID8/IHNyY31gKTtcbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgICBjb25zdCBodG1sID0gYDxkaXY+JHtjb250YWluZXIuaW5uZXJIVE1MfTwvZGl2PmA7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZShbXG4gICAgICAgIG5ldyBDbGlwYm9hcmRJdGVtKHtcbiAgICAgICAgICAndGV4dC9odG1sJzogbmV3IEJsb2IoW2h0bWxdLCB7IHR5cGU6ICd0ZXh0L2h0bWwnIH0pLFxuICAgICAgICAgICd0ZXh0L3BsYWluJzogbmV3IEJsb2IoW3NlbGVjdGlvbl0sIHsgdHlwZTogJ3RleHQvcGxhaW4nIH0pLFxuICAgICAgICB9KSxcbiAgICAgIF0pO1xuICAgICAgbmV3IE5vdGljZSgnQ29waWVkIGFzIEhUTUwgd2l0aCBlbWJlZGRlZCBpbWFnZXMnKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0NsaXBib2FyZCB3cml0ZSBmYWlsZWQnLCBlcnIpO1xuICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHknKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIFJpY2ggY29weSAobWFya2Rvd24gc2VsZWN0aW9uIFx1MjE5MiB0ZXh0L3BsYWluICsgdGV4dC9odG1sIHdpdGggZW1iZWRkZWQgaW1hZ2VzKSAtLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZVJpY2hDbGlwYm9hcmQobWFya2Rvd246IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNvdXJjZVBhdGggPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpPy5wYXRoID8/ICcnO1xuICAgIGNvbnN0IGh0bWwgPSBhd2FpdCB0aGlzLm1hcmtkb3duVG9IdG1sV2l0aEVtYmVkZGVkSW1hZ2VzKG1hcmtkb3duLCBzb3VyY2VQYXRoKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBodG1sQmxvYiA9IG5ldyBCbG9iKFtodG1sXSwgeyB0eXBlOiAndGV4dC9odG1sJyB9KTtcbiAgICAgIGNvbnN0IHRleHRCbG9iID0gbmV3IEJsb2IoW21hcmtkb3duXSwgeyB0eXBlOiAndGV4dC9wbGFpbicgfSk7XG4gICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlKFtcbiAgICAgICAgbmV3IENsaXBib2FyZEl0ZW0oeyAndGV4dC9odG1sJzogaHRtbEJsb2IsICd0ZXh0L3BsYWluJzogdGV4dEJsb2IgfSksXG4gICAgICBdKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1JpY2ggY2xpcGJvYXJkIHdyaXRlIGZhaWxlZCcsIGVycik7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChtYXJrZG93bik7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgbmV3IE5vdGljZSgnRmFpbGVkIHRvIGNvcHknKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIG1hcmtkb3duVG9IdG1sV2l0aEVtYmVkZGVkSW1hZ2VzKG1hcmtkb3duOiBzdHJpbmcsIHNvdXJjZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgLy8gQ29sbGVjdCBhbGwgaW1hZ2UgcmVmcyBmaXJzdCwgcmVzb2x2ZSB0byBkYXRhIFVSTHMgaW4gcGFyYWxsZWxcbiAgICBjb25zdCByZWZzOiBBcnJheTx7IHJhdzogc3RyaW5nOyBzcmM6IHN0cmluZzsgYWx0OiBzdHJpbmcgfT4gPSBbXTtcbiAgICBjb25zdCBjb2xsZWN0ID0gKHJhdzogc3RyaW5nLCBzcmM6IHN0cmluZywgYWx0OiBzdHJpbmcpID0+IHtcbiAgICAgIHJlZnMucHVzaCh7IHJhdywgc3JjLCBhbHQgfSk7XG4gICAgfTtcblxuICAgIC8vIFBhdHRlcm46ICFbW3BhdGh8YWx0XV0gb3IgIVtbcGF0aF1dXG4gICAgbWFya2Rvd24ucmVwbGFjZSgvIVxcW1xcWyhbXlxcXV0rKVxcXVxcXS9nLCAocmF3LCBpbm5lcjogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBbbGlua3BhdGgsIGFsdCA9ICcnXSA9IGlubmVyLnNwbGl0KCd8Jyk7XG4gICAgICBjb2xsZWN0KHJhdywgbGlua3BhdGgudHJpbSgpLCBhbHQudHJpbSgpKTtcbiAgICAgIHJldHVybiByYXc7XG4gICAgfSk7XG4gICAgLy8gUGF0dGVybjogIVthbHRdKHVybClcbiAgICBtYXJrZG93bi5yZXBsYWNlKC8hXFxbKFteXFxdXSopXFxdXFwoKFteKV0rKVxcKS9nLCAocmF3LCBhbHQ6IHN0cmluZywgc3JjOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbGxlY3QocmF3LCBzcmMudHJpbSgpLCBhbHQpO1xuICAgICAgcmV0dXJuIHJhdztcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc29sdmVkID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTsgLy8gcmF3IFx1MjE5MiBmaW5hbCBzcmMgKGRhdGEgVVJMIG9yIG9yaWdpbmFsKVxuICAgIGF3YWl0IFByb21pc2UuYWxsKHJlZnMubWFwKGFzeW5jICh7IHJhdywgc3JjLCBhbHQgfSkgPT4ge1xuICAgICAgY29uc3QgZmluYWxTcmMgPSBhd2FpdCB0aGlzLnJlc29sdmVJbWFnZVNyYyhzcmMsIHNvdXJjZVBhdGgpO1xuICAgICAgcmVzb2x2ZWQuc2V0KHJhdywgZmluYWxTcmMgPz8gc3JjKTtcbiAgICB9KSk7XG5cbiAgICAvLyBSZW5kZXI6IHNwbGl0IGludG8gbGluZXMsIHJlcGxhY2UgaW1hZ2UgcmVmcyB3aXRoIDxpbWc+LCBlc2NhcGUgcmVzdFxuICAgIGNvbnN0IGxpbmVzID0gbWFya2Rvd24uc3BsaXQoJ1xcbicpO1xuICAgIGNvbnN0IGh0bWxMaW5lcyA9IGxpbmVzLm1hcCgobGluZSkgPT4ge1xuICAgICAgLy8gRmluZCBhbGwgaW1hZ2UtcmVmIG1hdGNoZXMgYW5kIHJlYnVpbGQgbGluZVxuICAgICAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gICAgICBsZXQgY3Vyc29yID0gMDtcbiAgICAgIGNvbnN0IGNvbWJpbmVkID0gLyFcXFtcXFsoW15cXF1dKylcXF1cXF18IVxcWyhbXlxcXV0qKVxcXVxcKChbXildKylcXCkvZztcbiAgICAgIGxldCBtOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsO1xuICAgICAgd2hpbGUgKChtID0gY29tYmluZWQuZXhlYyhsaW5lKSkgIT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgYmVmb3JlID0gbGluZS5zbGljZShjdXJzb3IsIG0uaW5kZXgpO1xuICAgICAgICBpZiAoYmVmb3JlKSBwYXJ0cy5wdXNoKGVzY2FwZUh0bWwoYmVmb3JlKSk7XG4gICAgICAgIGNvbnN0IHJhdyA9IG1bMF07XG4gICAgICAgIGNvbnN0IGFsdCA9IChtWzJdID8/IG1bMV0/LnNwbGl0KCd8JylbMV0gPz8gJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3QgZmluYWxTcmMgPSByZXNvbHZlZC5nZXQocmF3KSA/PyAnJztcbiAgICAgICAgcGFydHMucHVzaChgPGltZyBzcmM9XCIke2VzY2FwZUF0dHIoZmluYWxTcmMpfVwiIGFsdD1cIiR7ZXNjYXBlQXR0cihhbHQpfVwiPmApO1xuICAgICAgICBjdXJzb3IgPSBtLmluZGV4ICsgcmF3Lmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3QgPSBsaW5lLnNsaWNlKGN1cnNvcik7XG4gICAgICBpZiAocmVzdCkgcGFydHMucHVzaChlc2NhcGVIdG1sKHJlc3QpKTtcbiAgICAgIHJldHVybiBwYXJ0cy5qb2luKCcnKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBgPGRpdj4ke2h0bWxMaW5lcy5qb2luKCc8YnI+Jyl9PC9kaXY+YDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUltYWdlU3JjKHNyYzogc3RyaW5nLCBzb3VyY2VQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICAvLyBBbHJlYWR5IGlubGluZSAvIHJlbW90ZVxuICAgIGlmIChzcmMuc3RhcnRzV2l0aCgnZGF0YTonKSkgcmV0dXJuIHNyYztcbiAgICBpZiAoL15odHRwcz86XFwvXFwvL2kudGVzdChzcmMpKSB7XG4gICAgICBjb25zdCBkYXRhVXJsID0gYXdhaXQgZmV0Y2hBc0RhdGFVcmwoc3JjKTtcbiAgICAgIHJldHVybiBkYXRhVXJsID8/IHNyYztcbiAgICB9XG5cbiAgICAvLyBWYXVsdC1yZXNvbHZlZCBwYXRoXG4gICAgY29uc3QgbGlua3BhdGggPSBkZWNvZGVVUklDb21wb25lbnQoc3JjKS5yZXBsYWNlKC9eXFwvKy8sICcnKTtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChsaW5rcGF0aCwgc291cmNlUGF0aCk7XG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkgcmV0dXJuIG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgYnVmID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZWFkQmluYXJ5KGZpbGUucGF0aCk7XG4gICAgICBpZiAoYnVmLmJ5dGVMZW5ndGggPiBNQVhfRU1CRURfQllURVMpIHtcbiAgICAgICAgbmV3IE5vdGljZShgU2tpcHBlZCBlbWJlZGRpbmcgKHRvbyBsYXJnZSk6ICR7ZmlsZS5uYW1lfWApO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGV4dCA9IGZpbGUuZXh0ZW5zaW9uLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBtaW1lID0gSU1BR0VfRVhUX01JTUVbZXh0XSA/PyAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJztcbiAgICAgIHJldHVybiBgZGF0YToke21pbWV9O2Jhc2U2NCwke2FycmF5QnVmZmVyVG9CYXNlNjQoYnVmKX1gO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHJlYWQgdmF1bHQgaW1hZ2UnLCBlcnIpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0gSGVscGVycyAtLS0tXG5cbmZ1bmN0aW9uIGhhc0ltYWdlUmVmKHRleHQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gLyFcXFtcXFtbXlxcXV0rXFxdXFxdfCFcXFtbXlxcXV0qXFxdXFwoW14pXStcXCkvLnRlc3QodGV4dCk7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWwoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpO1xufVxuXG5mdW5jdGlvbiBlc2NhcGVBdHRyKHM6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvXCIvZywgJyZxdW90OycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7Jyk7XG59XG5cbmZ1bmN0aW9uIGFycmF5QnVmZmVyVG9CYXNlNjQoYnVmOiBBcnJheUJ1ZmZlcik6IHN0cmluZyB7XG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYnVmKTtcbiAgY29uc3QgQ0hVTksgPSAweDgwMDA7XG4gIGxldCBiaW5hcnkgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gQ0hVTkspIHtcbiAgICBjb25zdCBzdWIgPSBieXRlcy5zdWJhcnJheShpLCBpICsgQ0hVTkspO1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIEFycmF5LmZyb20oc3ViKSk7XG4gIH1cbiAgcmV0dXJuIGJ0b2EoYmluYXJ5KTtcbn1cblxuY29uc3QgQ0FMTE9VVF9DT0xPUlM6IFJlY29yZDxzdHJpbmcsIHsgYm9yZGVyOiBzdHJpbmc7IGJnOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmcgfT4gPSB7XG4gIG5vdGU6ICAgICB7IGJvcmRlcjogJyM0NDhhZmYnLCBiZzogJyNlM2YyZmQnLCB0aXRsZTogJyMxNTY1YzAnIH0sXG4gIGFic3RyYWN0OiB7IGJvcmRlcjogJyMwMGJjZDQnLCBiZzogJyNlMGY3ZmEnLCB0aXRsZTogJyMwMDgzOGYnIH0sXG4gIHN1bW1hcnk6ICB7IGJvcmRlcjogJyMwMGJjZDQnLCBiZzogJyNlMGY3ZmEnLCB0aXRsZTogJyMwMDgzOGYnIH0sXG4gIHRsZHI6ICAgICB7IGJvcmRlcjogJyMwMGJjZDQnLCBiZzogJyNlMGY3ZmEnLCB0aXRsZTogJyMwMDgzOGYnIH0sXG4gIGluZm86ICAgICB7IGJvcmRlcjogJyMwMGI4ZDQnLCBiZzogJyNlMWY1ZmUnLCB0aXRsZTogJyMwMjc3YmQnIH0sXG4gIHRvZG86ICAgICB7IGJvcmRlcjogJyMwMGIwZmYnLCBiZzogJyNlMWY1ZmUnLCB0aXRsZTogJyMwMjc3YmQnIH0sXG4gIHRpcDogICAgICB7IGJvcmRlcjogJyMwMGJmYTUnLCBiZzogJyNlMGYyZjEnLCB0aXRsZTogJyMwMDY5NWMnIH0sXG4gIGhpbnQ6ICAgICB7IGJvcmRlcjogJyMwMGJmYTUnLCBiZzogJyNlMGYyZjEnLCB0aXRsZTogJyMwMDY5NWMnIH0sXG4gIGltcG9ydGFudDp7IGJvcmRlcjogJyMwMGJmYTUnLCBiZzogJyNlMGYyZjEnLCB0aXRsZTogJyMwMDY5NWMnIH0sXG4gIHN1Y2Nlc3M6ICB7IGJvcmRlcjogJyMwMGM4NTMnLCBiZzogJyNlOGY1ZTknLCB0aXRsZTogJyMyZTdkMzInIH0sXG4gIGNoZWNrOiAgICB7IGJvcmRlcjogJyMwMGM4NTMnLCBiZzogJyNlOGY1ZTknLCB0aXRsZTogJyMyZTdkMzInIH0sXG4gIGRvbmU6ICAgICB7IGJvcmRlcjogJyMwMGM4NTMnLCBiZzogJyNlOGY1ZTknLCB0aXRsZTogJyMyZTdkMzInIH0sXG4gIHF1ZXN0aW9uOiB7IGJvcmRlcjogJyM2NGRkMTcnLCBiZzogJyNmMWY4ZTknLCB0aXRsZTogJyM1NThiMmYnIH0sXG4gIGhlbHA6ICAgICB7IGJvcmRlcjogJyM2NGRkMTcnLCBiZzogJyNmMWY4ZTknLCB0aXRsZTogJyM1NThiMmYnIH0sXG4gIGZhcTogICAgICB7IGJvcmRlcjogJyM2NGRkMTcnLCBiZzogJyNmMWY4ZTknLCB0aXRsZTogJyM1NThiMmYnIH0sXG4gIHdhcm5pbmc6ICB7IGJvcmRlcjogJyNmZjkxMDAnLCBiZzogJyNmZmYzZTAnLCB0aXRsZTogJyNlNjUxMDAnIH0sXG4gIGNhdXRpb246ICB7IGJvcmRlcjogJyNmZjkxMDAnLCBiZzogJyNmZmYzZTAnLCB0aXRsZTogJyNlNjUxMDAnIH0sXG4gIGF0dGVudGlvbjp7IGJvcmRlcjogJyNmZjkxMDAnLCBiZzogJyNmZmYzZTAnLCB0aXRsZTogJyNlNjUxMDAnIH0sXG4gIGZhaWx1cmU6ICB7IGJvcmRlcjogJyNmZjUyNTInLCBiZzogJyNmZmViZWUnLCB0aXRsZTogJyNjNjI4MjgnIH0sXG4gIGZhaWw6ICAgICB7IGJvcmRlcjogJyNmZjUyNTInLCBiZzogJyNmZmViZWUnLCB0aXRsZTogJyNjNjI4MjgnIH0sXG4gIG1pc3Npbmc6ICB7IGJvcmRlcjogJyNmZjUyNTInLCBiZzogJyNmZmViZWUnLCB0aXRsZTogJyNjNjI4MjgnIH0sXG4gIGRhbmdlcjogICB7IGJvcmRlcjogJyNmZjE3NDQnLCBiZzogJyNmZmViZWUnLCB0aXRsZTogJyNiNzFjMWMnIH0sXG4gIGVycm9yOiAgICB7IGJvcmRlcjogJyNmZjE3NDQnLCBiZzogJyNmZmViZWUnLCB0aXRsZTogJyNiNzFjMWMnIH0sXG4gIGJ1ZzogICAgICB7IGJvcmRlcjogJyNmNTAwNTcnLCBiZzogJyNmY2U0ZWMnLCB0aXRsZTogJyNhZDE0NTcnIH0sXG4gIGV4YW1wbGU6ICB7IGJvcmRlcjogJyM3YzRkZmYnLCBiZzogJyNlZGU3ZjYnLCB0aXRsZTogJyM0NTI3YTAnIH0sXG4gIHF1b3RlOiAgICB7IGJvcmRlcjogJyM5ZTllOWUnLCBiZzogJyNmYWZhZmEnLCB0aXRsZTogJyM0MjQyNDInIH0sXG4gIGNpdGU6ICAgICB7IGJvcmRlcjogJyM5ZTllOWUnLCBiZzogJyNmYWZhZmEnLCB0aXRsZTogJyM0MjQyNDInIH0sXG59O1xuXG5mdW5jdGlvbiBzZXRTdHlsZShlbDogSFRNTEVsZW1lbnQsIGNzczogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IGV4aXN0aW5nID0gZWwuZ2V0QXR0cmlidXRlKCdzdHlsZScpID8/ICcnO1xuICBlbC5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgZXhpc3RpbmcgPyBgJHtleGlzdGluZ307ICR7Y3NzfWAgOiBjc3MpO1xufVxuXG5mdW5jdGlvbiBpbmxpbmVTdHlsZUZvckV4dGVybmFsUGFzdGUocm9vdDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgLy8gQ29kZSBibG9ja3MgKHByZSA+IGNvZGUpXG4gIHJvb3QucXVlcnlTZWxlY3RvckFsbCgncHJlJykuZm9yRWFjaCgocHJlKSA9PiB7XG4gICAgc2V0U3R5bGUocHJlIGFzIEhUTUxFbGVtZW50LFxuICAgICAgJ2JhY2tncm91bmQ6I2Y2ZjhmYTsgYm9yZGVyOjFweCBzb2xpZCAjZTFlNGU4OyBib3JkZXItcmFkaXVzOjZweDsgJyArXG4gICAgICAncGFkZGluZzoxMnB4IDE2cHg7IG1hcmdpbjo4cHggMDsgJyArXG4gICAgICAnZm9udC1mYW1pbHk6TWVubG8sIENvbnNvbGFzLCBcIkNvdXJpZXIgTmV3XCIsIG1vbm9zcGFjZTsgZm9udC1zaXplOjEzcHg7ICcgK1xuICAgICAgJ2xpbmUtaGVpZ2h0OjEuNDU7IHdoaXRlLXNwYWNlOnByZS13cmFwOyBvdmVyZmxvdy14OmF1dG87IGNvbG9yOiMyNDI5MmUnXG4gICAgKTtcbiAgfSk7XG4gIC8vIElubGluZSBjb2RlIChub3QgaW5zaWRlIDxwcmU+KVxuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ2NvZGUnKS5mb3JFYWNoKChjb2RlKSA9PiB7XG4gICAgaWYgKGNvZGUuY2xvc2VzdCgncHJlJykpIHJldHVybjtcbiAgICBzZXRTdHlsZShjb2RlIGFzIEhUTUxFbGVtZW50LFxuICAgICAgJ2JhY2tncm91bmQ6I2Y2ZjhmYTsgcGFkZGluZzoycHggNnB4OyBib3JkZXItcmFkaXVzOjRweDsgJyArXG4gICAgICAnZm9udC1mYW1pbHk6TWVubG8sIENvbnNvbGFzLCBcIkNvdXJpZXIgTmV3XCIsIG1vbm9zcGFjZTsgZm9udC1zaXplOjAuOWVtOyBjb2xvcjojZDYzMzZjJ1xuICAgICk7XG4gIH0pO1xuXG4gIC8vIEhpZ2hsaWdodHMgKD09dGV4dD09IFx1MjE5MiA8bWFyaz4pXG4gIHJvb3QucXVlcnlTZWxlY3RvckFsbCgnbWFyaycpLmZvckVhY2goKG1rKSA9PiB7XG4gICAgc2V0U3R5bGUobWsgYXMgSFRNTEVsZW1lbnQsICdiYWNrZ3JvdW5kOiNmZmY1OWQ7IHBhZGRpbmc6MCAycHgnKTtcbiAgfSk7XG5cbiAgLy8gQmxvY2txdW90ZXNcbiAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCdibG9ja3F1b3RlJykuZm9yRWFjaCgoYnEpID0+IHtcbiAgICBpZiAoKGJxIGFzIEhUTUxFbGVtZW50KS5jbGFzc0xpc3QuY29udGFpbnMoJ2NhbGxvdXQnKSkgcmV0dXJuO1xuICAgIHNldFN0eWxlKGJxIGFzIEhUTUxFbGVtZW50LFxuICAgICAgJ2JvcmRlci1sZWZ0OjRweCBzb2xpZCAjZGZlMmU1OyBtYXJnaW46OHB4IDA7IHBhZGRpbmc6NHB4IDEycHg7ICcgK1xuICAgICAgJ2NvbG9yOiM1ODYwNjk7IGJhY2tncm91bmQ6I2ZhZmJmYydcbiAgICApO1xuICB9KTtcblxuICAvLyBDYWxsb3V0c1xuICByb290LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCcuY2FsbG91dCcpLmZvckVhY2goKGNvKSA9PiB7XG4gICAgY29uc3QgdHlwZSA9IChjby5nZXRBdHRyaWJ1dGUoJ2RhdGEtY2FsbG91dCcpIHx8ICdub3RlJykudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBjb2xvcnMgPSBDQUxMT1VUX0NPTE9SU1t0eXBlXSA/PyBDQUxMT1VUX0NPTE9SUy5ub3RlO1xuICAgIHNldFN0eWxlKGNvLFxuICAgICAgYGJvcmRlci1sZWZ0OjRweCBzb2xpZCAke2NvbG9ycy5ib3JkZXJ9OyBiYWNrZ3JvdW5kOiR7Y29sb3JzLmJnfTsgYCArXG4gICAgICBgYm9yZGVyLXJhZGl1czo0cHg7IHBhZGRpbmc6MTBweCAxNHB4OyBtYXJnaW46OHB4IDA7IGNvbG9yOiMyNDI5MmVgXG4gICAgKTtcbiAgICBjby5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignLmNhbGxvdXQtdGl0bGUnKS5mb3JFYWNoKCh0KSA9PiB7XG4gICAgICBzZXRTdHlsZSh0LCBgY29sb3I6JHtjb2xvcnMudGl0bGV9OyBmb250LXdlaWdodDo2MDA7IG1hcmdpbi1ib3R0b206NHB4OyBkaXNwbGF5OmJsb2NrYCk7XG4gICAgfSk7XG4gICAgY28ucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJy5jYWxsb3V0LWljb24sIC5jYWxsb3V0LWZvbGQnKS5mb3JFYWNoKChlbCkgPT4gZWwucmVtb3ZlKCkpO1xuICB9KTtcblxuICAvLyBUYWJsZXNcbiAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCd0YWJsZScpLmZvckVhY2goKHRibCkgPT4ge1xuICAgIHNldFN0eWxlKHRibCBhcyBIVE1MRWxlbWVudCxcbiAgICAgICdib3JkZXItY29sbGFwc2U6Y29sbGFwc2U7IG1hcmdpbjo4cHggMDsgYm9yZGVyOjFweCBzb2xpZCAjZDBkN2RlJ1xuICAgICk7XG4gIH0pO1xuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ3RoLCB0ZCcpLmZvckVhY2goKGNlbGwpID0+IHtcbiAgICBzZXRTdHlsZShjZWxsIGFzIEhUTUxFbGVtZW50LCAnYm9yZGVyOjFweCBzb2xpZCAjZDBkN2RlOyBwYWRkaW5nOjZweCAxMnB4Jyk7XG4gIH0pO1xuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ3RoJykuZm9yRWFjaCgodGgpID0+IHtcbiAgICBzZXRTdHlsZSh0aCBhcyBIVE1MRWxlbWVudCwgJ2JhY2tncm91bmQ6I2Y2ZjhmYTsgZm9udC13ZWlnaHQ6NjAwJyk7XG4gIH0pO1xuXG4gIC8vIEhvcml6b250YWwgcnVsZVxuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ2hyJykuZm9yRWFjaCgoaHIpID0+IHtcbiAgICBzZXRTdHlsZShociBhcyBIVE1MRWxlbWVudCwgJ2JvcmRlcjowOyBib3JkZXItdG9wOjFweCBzb2xpZCAjZDBkN2RlOyBtYXJnaW46MTZweCAwJyk7XG4gIH0pO1xuXG4gIC8vIEhlYWRpbmdzIFx1MjAxNCBrZWVwIHNvbWUgaGllcmFyY2h5IHdoZW4gY2xhc3NlcyBhcmUgc3RyaXBwZWRcbiAgY29uc3QgaGVhZGluZ1NpemU6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IEgxOiAnMS44ZW0nLCBIMjogJzEuNWVtJywgSDM6ICcxLjI1ZW0nLCBINDogJzEuMWVtJywgSDU6ICcxZW0nLCBINjogJzAuOWVtJyB9O1xuICByb290LnF1ZXJ5U2VsZWN0b3JBbGwoJ2gxLCBoMiwgaDMsIGg0LCBoNSwgaDYnKS5mb3JFYWNoKChoKSA9PiB7XG4gICAgY29uc3Qgc2l6ZSA9IGhlYWRpbmdTaXplW2gudGFnTmFtZV0gPz8gJzFlbSc7XG4gICAgc2V0U3R5bGUoaCBhcyBIVE1MRWxlbWVudCwgYGZvbnQtd2VpZ2h0OjcwMDsgbWFyZ2luOjAuNmVtIDAgMC4zZW07IGZvbnQtc2l6ZToke3NpemV9YCk7XG4gIH0pO1xuXG4gIC8vIFRhc2sgbGlzdCBjaGVja2JveGVzIFx1MjAxNCByZXBsYWNlIHdpdGggdW5pY29kZSBzbyBEb2NzIHJlbmRlcnMgc29tZXRoaW5nIHZpc2libGVcbiAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxJbnB1dEVsZW1lbnQ+KCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl0nKS5mb3JFYWNoKChjYikgPT4ge1xuICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gICAgc3Bhbi50ZXh0Q29udGVudCA9IGNiLmNoZWNrZWQgPyAnXHUyNjExICcgOiAnXHUyNjEwICc7XG4gICAgc2V0U3R5bGUoc3BhbiwgJ2ZvbnQtZmFtaWx5Om1vbm9zcGFjZScpO1xuICAgIGNiLnJlcGxhY2VXaXRoKHNwYW4pO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBc0RhdGFVcmwodXJsOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgIGlmICghcmVzLm9rKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBibG9iID0gYXdhaXQgcmVzLmJsb2IoKTtcbiAgICBpZiAoYmxvYi5zaXplID4gTUFYX0VNQkVEX0JZVEVTKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBidWYgPSBhd2FpdCBibG9iLmFycmF5QnVmZmVyKCk7XG4gICAgY29uc3QgbWltZSA9IGJsb2IudHlwZSB8fCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJztcbiAgICByZXR1cm4gYGRhdGE6JHttaW1lfTtiYXNlNjQsJHthcnJheUJ1ZmZlclRvQmFzZTY0KGJ1Zil9YDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHNCQUEwRjtBQUUxRixJQUFNLGVBQWU7QUFDckIsSUFBTSxjQUFjO0FBQ3BCLElBQU0sZUFBZTtBQUNyQixJQUFNLHFCQUFxQjtBQUMzQixJQUFNLGlCQUFpQjtBQUN2QixJQUFNLGtCQUFrQixJQUFJLE9BQU87QUFFbkMsSUFBTSxpQkFBeUM7QUFBQSxFQUM3QyxLQUFLO0FBQUEsRUFDTCxLQUFLO0FBQUEsRUFDTCxNQUFNO0FBQUEsRUFDTixLQUFLO0FBQUEsRUFDTCxNQUFNO0FBQUEsRUFDTixLQUFLO0FBQUEsRUFDTCxLQUFLO0FBQUEsRUFDTCxNQUFNO0FBQ1I7QUFXQSxJQUFxQixxQkFBckIsY0FBZ0QsdUJBQU87QUFBQSxFQUF2RDtBQUFBO0FBQ0UsU0FBUSxZQUFtQztBQUMzQyxTQUFRLFVBQW1CLEVBQUUsVUFBVSxHQUFHLFdBQVcsR0FBRyxXQUFXLEdBQUcsWUFBWSxHQUFHLE1BQU0sR0FBRyxLQUFLLEVBQUU7QUFDckcsU0FBUSxlQUE2QjtBQUNyQyxTQUFRLHlCQUFpRDtBQUN6RCxTQUFRLFFBQXVCO0FBRS9CLFNBQVEsbUJBQW1CLENBQUMsUUFBb0I7QUFDOUMsWUFBTSxTQUFTLElBQUk7QUFDbkIsWUFBTSxNQUFNLGtCQUFrQixtQkFDMUIsU0FDQSxPQUFPLFFBQVEsS0FBSztBQUN4QixVQUFJLENBQUMsT0FBTyxFQUFFLGVBQWU7QUFBbUI7QUFDaEQsVUFBSSxDQUFD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V0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxXQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxTQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxPQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxNQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxVQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxNQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxLQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxTQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxTQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxXQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxTQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxNQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxTQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxRQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxPQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxLQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxTQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxPQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFBQSxFQUMvRCxNQUFVLEVBQUUsUUFBUSxXQUFXLElBQUksV0FBVyxPQUFPLFVBQVU7QUFDakU7QUFFQSxTQUFTLFNBQVMsSUFBaUIsS0FBbUI7QUEzbUJ0RDtBQTRtQkUsUUFBTSxZQUFXLFFBQUcsYUFBYSxPQUFPLE1BQXZCLFlBQTRCO0FBQzdDLEtBQUcsYUFBYSxTQUFTLFdBQVcsR0FBRyxhQUFhLFFBQVEsR0FBRztBQUNqRTtBQUVBLFNBQVMsNEJBQTRCLE1BQXlCO0FBRTVELE9BQUssaUJBQWlCLEtBQUssRUFBRSxRQUFRLENBQUMsUUFBUTtBQUM1QztBQUFBLE1BQVM7QUFBQSxNQUNQO0FBQUEsSUFJRjtBQUFBLEVBQ0YsQ0FBQztBQUVELE9BQUssaUJBQWlCLE1BQU0sRUFBRSxRQUFRLENBQUMsU0FBUztBQUM5QyxRQUFJLEtBQUssUUFBUSxLQUFLO0FBQUc7QUFDekI7QUFBQSxNQUFTO0FBQUEsTUFDUDtBQUFBLElBRUY7QUFBQSxFQUNGLENBQUM7QUFHRCxPQUFLLGlCQUFpQixNQUFNLEVBQUUsUUFBUSxDQUFDLE9BQU87QUFDNUMsYUFBUyxJQUFtQixtQ0FBbUM7QUFBQSxFQUNqRSxDQUFDO0FBR0QsT0FBSyxpQkFBaUIsWUFBWSxFQUFFLFFBQVEsQ0FBQyxPQUFPO0FBQ2xELFFBQUssR0FBbUIsVUFBVSxTQUFTLFNBQVM7QUFBRztBQUN2RDtBQUFBLE1BQVM7QUFBQSxNQUNQO0FBQUEsSUFFRjtBQUFBLEVBQ0YsQ0FBQztBQUdELE9BQUssaUJBQThCLFVBQVUsRUFBRSxRQUFRLENBQUMsT0FBTztBQWxwQmpFO0FBbXBCSSxVQUFNLFFBQVEsR0FBRyxhQUFhLGNBQWMsS0FBSyxRQUFRLFlBQVk7QUFDckUsVUFBTSxVQUFTLG9CQUFlLElBQUksTUFBbkIsWUFBd0IsZUFBZTtBQUN0RDtBQUFBLE1BQVM7QUFBQSxNQUNQLHlCQUF5QixPQUFPLHNCQUFzQixPQUFPO0FBQUEsSUFFL0Q7QUFDQSxPQUFHLGlCQUE4QixnQkFBZ0IsRUFBRSxRQUFRLENBQUMsTUFBTTtBQUNoRSxlQUFTLEdBQUcsU0FBUyxPQUFPLDBEQUEwRDtBQUFBLElBQ3hGLENBQUM7QUFDRCxPQUFHLGlCQUE4Qiw4QkFBOEIsRUFBRSxRQUFRLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQztBQUFBLEVBQzlGLENBQUM7QUFHRCxPQUFLLGlCQUFpQixPQUFPLEVBQUUsUUFBUSxDQUFDLFFBQVE7QUFDOUM7QUFBQSxNQUFTO0FBQUEsTUFDUDtBQUFBLElBQ0Y7QUFBQSxFQUNGLENBQUM7QUFDRCxPQUFLLGlCQUFpQixRQUFRLEVBQUUsUUFBUSxDQUFDLFNBQVM7QUFDaEQsYUFBUyxNQUFxQiw0Q0FBNEM7QUFBQSxFQUM1RSxDQUFDO0FBQ0QsT0FBSyxpQkFBaUIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxPQUFPO0FBQzFDLGFBQVMsSUFBbUIscUNBQXFDO0FBQUEsRUFDbkUsQ0FBQztBQUdELE9BQUssaUJBQWlCLElBQUksRUFBRSxRQUFRLENBQUMsT0FBTztBQUMxQyxhQUFTLElBQW1CLHVEQUF1RDtBQUFBLEVBQ3JGLENBQUM7QUFHRCxRQUFNLGNBQXNDLEVBQUUsSUFBSSxTQUFTLElBQUksU0FBUyxJQUFJLFVBQVUsSUFBSSxTQUFTLElBQUksT0FBTyxJQUFJLFFBQVE7QUFDMUgsT0FBSyxpQkFBaUIsd0JBQXdCLEVBQUUsUUFBUSxDQUFDLE1BQU07QUFuckJqRTtBQW9yQkksVUFBTSxRQUFPLGlCQUFZLEVBQUUsT0FBTyxNQUFyQixZQUEwQjtBQUN2QyxhQUFTLEdBQWtCLG9EQUFvRCxNQUFNO0FBQUEsRUFDdkYsQ0FBQztBQUdELE9BQUssaUJBQW1DLHdCQUF3QixFQUFFLFFBQVEsQ0FBQyxPQUFPO0FBQ2hGLFVBQU0sT0FBTyxTQUFTLGNBQWMsTUFBTTtBQUMxQyxTQUFLLGNBQWMsR0FBRyxVQUFVLFlBQU87QUFDdkMsYUFBUyxNQUFNLHVCQUF1QjtBQUN0QyxPQUFHLFlBQVksSUFBSTtBQUFBLEVBQ3JCLENBQUM7QUFDSDtBQUVBLGVBQWUsZUFBZSxLQUFxQztBQUNqRSxNQUFJO0FBQ0YsVUFBTSxNQUFNLE1BQU0sTUFBTSxHQUFHO0FBQzNCLFFBQUksQ0FBQyxJQUFJO0FBQUksYUFBTztBQUNwQixVQUFNLE9BQU8sTUFBTSxJQUFJLEtBQUs7QUFDNUIsUUFBSSxLQUFLLE9BQU87QUFBaUIsYUFBTztBQUN4QyxVQUFNLE1BQU0sTUFBTSxLQUFLLFlBQVk7QUFDbkMsVUFBTSxPQUFPLEtBQUssUUFBUTtBQUMxQixXQUFPLFFBQVEsZUFBZSxvQkFBb0IsR0FBRztBQUFBLEVBQ3ZELFNBQVEsR0FBTjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbIl9hIl0KfQo=
