var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ExportWithImageUploadPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_path = __toESM(require("path"));
var import_fs = require("fs");
var import_electron = require("electron");
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "tiff",
  "ico"
]);
var DEFAULT_SETTINGS = {
  exportRoot: "ExportedNotes",
  uploadServer: "http://127.0.0.1:36677/upload",
  remoteServerMode: false,
  overwriteExisting: true,
  openAfterExport: true
};
var ExportWithImageUploadPlugin = class extends import_obsidian.Plugin {
  settings;
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("upload", "Export note with uploaded images", () => this.exportActiveNote());
    this.addCommand({
      id: "export-note-with-image-upload",
      name: "Export note with uploaded images",
      callback: () => this.exportActiveNote()
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian.TFile) {
          menu.addItem(
            (item) => item.setTitle("Export with image upload").setIcon("upload").onClick(() => this.exportNote(file))
          );
        }
      })
    );
    this.addSettingTab(new ExportSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  getBasePath() {
    const adapter = this.app.vault.adapter;
    if (adapter.getBasePath) {
      return adapter.getBasePath();
    }
    if (adapter.basePath) {
      return adapter.basePath;
    }
    throw new Error("File system adapter does not expose base path.");
  }
  toAbsolute(vaultPath) {
    return import_path.default.join(this.getBasePath(), vaultPath.split("/").join(import_path.default.sep));
  }
  sanitizeName(name) {
    return name.replace(/[/\\?%*:|"<>]/g, "-").trim();
  }
  async ensureFolder(folderPath) {
    const exists = await this.app.vault.adapter.exists(folderPath);
    if (!exists) {
      await this.app.vault.adapter.mkdir(folderPath);
    }
  }
  resolveVaultPath(link, file) {
    const cleaned = (0, import_obsidian.normalizePath)(link);
    if (cleaned.startsWith("http://") || cleaned.startsWith("https://") || cleaned.startsWith("data:") || cleaned.startsWith("obsidian://")) {
      return null;
    }
    const currentDir = (0, import_obsidian.normalizePath)(import_path.default.posix.dirname(file.path));
    const vaultPath = cleaned.startsWith("/") ? cleaned.replace(/^\//, "") : (0, import_obsidian.normalizePath)(import_path.default.posix.join(currentDir, cleaned));
    return vaultPath;
  }
  collectImages(content, file) {
    const results = [];
    const markdownRegex = /!\[(.*?)\]\((.*?)\)/g;
    let mdMatch;
    while ((mdMatch = markdownRegex.exec(content)) !== null) {
      const alt = mdMatch[1].trim();
      const rawLink = mdMatch[2].trim();
      const link = rawLink.split(" ")[0];
      const vaultPath = this.resolveVaultPath(link, file) || void 0;
      const absPath = vaultPath ? this.toAbsolute(vaultPath) : void 0;
      const isLocal = !!absPath && !link.startsWith("http") && !link.startsWith("data:") && !link.startsWith("obsidian://");
      results.push({
        match: mdMatch[0],
        alt: alt || import_path.default.basename(link),
        originalLink: link,
        vaultPath,
        absPath,
        isLocal
      });
    }
    const wikiRegex = /!\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g;
    let wkMatch;
    while ((wkMatch = wikiRegex.exec(content)) !== null) {
      const target = wkMatch[1].trim();
      const alias = wkMatch[3] ? wkMatch[3].substring(1) : "";
      const alt = alias || import_path.default.basename(target);
      const dest = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
      let vaultPath;
      if (dest && IMAGE_EXTENSIONS.has(dest.extension.toLowerCase())) {
        vaultPath = dest.path;
      } else {
        const resolved = this.resolveVaultPath(target, file);
        vaultPath = resolved || void 0;
      }
      const absPath = vaultPath ? this.toAbsolute(vaultPath) : void 0;
      results.push({
        match: wkMatch[0],
        alt,
        originalLink: vaultPath || target,
        vaultPath,
        absPath,
        isLocal: !!absPath
      });
    }
    return results;
  }
  convertWikiLinks(content) {
    const wikiRegex = /(!)?\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g;
    return content.replace(wikiRegex, (match, isImage, target, heading, alias) => {
      if (isImage) return match;
      const display = alias ? String(alias).substring(1) : heading ? `${target}${heading}` : target;
      const sanitizedTarget = this.sanitizeName(target);
      const link = `${sanitizedTarget}.md${heading ?? ""}`;
      return `[${display}](${link})`;
    });
  }
  parseUploadResult(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.result)) return data.result;
    if (typeof data?.result === "string") return [data.result];
    if (Array.isArray(data?.fullResult)) {
      const urls = data.fullResult.map((item) => item?.imgUrl || item?.url || item?.imageUrl).filter((v) => typeof v === "string");
      if (urls.length) return urls;
    }
    if (typeof data?.url === "string") return [data.url];
    return [];
  }
  async uploadFiles(absPaths) {
    if (!absPaths.length) return [];
    if (this.settings.remoteServerMode) {
      const form = new FormData();
      for (const abs of absPaths) {
        const buffer = await import_fs.promises.readFile(abs);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const file = new File([arrayBuffer], import_path.default.basename(abs));
        form.append("list", file);
      }
      const response2 = await fetch(this.settings.uploadServer, { method: "POST", body: form });
      if (!response2.ok) {
        throw new Error(`Upload failed with status ${response2.status}`);
      }
      const data2 = await response2.json();
      return this.parseUploadResult(data2);
    }
    const response = await (0, import_obsidian.requestUrl)({
      url: this.settings.uploadServer,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list: absPaths })
    });
    const data = await response.json;
    return this.parseUploadResult(data);
  }
  async processContent(content, file) {
    let updated = content;
    const images = this.collectImages(content, file);
    const locals = images.filter((img) => img.isLocal && img.absPath);
    if (locals.length) {
      new import_obsidian.Notice(`\u4E0A\u4F20\u56FE\u7247\u4E2D (${locals.length})...`, 2e3);
      const uploadUrls = await this.uploadFiles(locals.map((i) => i.absPath));
      if (uploadUrls.length !== locals.length) {
        new import_obsidian.Notice("\u56FE\u7247\u4E0A\u4F20\u6570\u91CF\u4E0E\u8FD4\u56DE\u4E0D\u4E00\u81F4\uFF0C\u90E8\u5206\u4FDD\u6301\u672C\u5730\u94FE\u63A5");
      }
      locals.forEach((item, index) => {
        if (uploadUrls[index]) {
          item.finalUrl = uploadUrls[index];
        }
      });
    }
    images.forEach((item) => {
      const targetUrl = item.finalUrl || item.originalLink;
      const replacement = `![${item.alt}](${targetUrl})`;
      updated = updated.replace(item.match, replacement);
    });
    updated = this.convertWikiLinks(updated);
    return updated;
  }
  async exportNote(file) {
    const startNotice = new import_obsidian.Notice("\u5F00\u59CB\u5BFC\u51FA\u5E76\u4E0A\u4F20\u56FE\u7247...", 3e3);
    try {
      const content = await this.app.vault.cachedRead(file);
      const sanitizedName = this.sanitizeName(file.basename);
      const exportDir = (0, import_obsidian.normalizePath)(import_path.default.posix.join(this.settings.exportRoot, sanitizedName));
      await this.ensureFolder(exportDir);
      const targetName = `${sanitizedName}.md`;
      const exportPath = (0, import_obsidian.normalizePath)(import_path.default.posix.join(exportDir, targetName));
      const exists = await this.app.vault.adapter.exists(exportPath);
      if (exists && !this.settings.overwriteExisting) {
        new import_obsidian.Notice("\u76EE\u6807\u6587\u4EF6\u5DF2\u5B58\u5728\uFF0C\u672A\u8986\u76D6");
        return;
      }
      const processed = await this.processContent(content, file);
      await this.app.vault.adapter.write(exportPath, processed);
      if (this.settings.openAfterExport) {
        import_electron.shell.showItemInFolder(this.toAbsolute(exportPath));
      }
      new import_obsidian.Notice(`\u5BFC\u51FA\u6210\u529F\uFF1A${exportPath}`);
    } catch (error) {
      console.error(error);
      new import_obsidian.Notice(`\u5BFC\u51FA\u5931\u8D25\uFF1A${error.message}`);
    } finally {
      startNotice.hide();
    }
  }
  async exportActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u6587\u4EF6");
      return;
    }
    await this.exportNote(file);
  }
};
var ExportSettingTab = class extends import_obsidian.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Export root folder").setDesc("Vault-relative path for exported notes.").addText(
      (text) => text.setPlaceholder("ExportedNotes").setValue(this.plugin.settings.exportRoot).onChange(async (value) => {
        this.plugin.settings.exportRoot = value || DEFAULT_SETTINGS.exportRoot;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Upload server URL").setDesc("PicGo server upload endpoint.").addText(
      (text) => text.setPlaceholder(DEFAULT_SETTINGS.uploadServer).setValue(this.plugin.settings.uploadServer).onChange(async (value) => {
        this.plugin.settings.uploadServer = value || DEFAULT_SETTINGS.uploadServer;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Use multipart upload").setDesc("Enable when your server expects multipart/form-data uploads.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.remoteServerMode).onChange(async (value) => {
        this.plugin.settings.remoteServerMode = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Overwrite existing exports").setDesc("If disabled, existing files will be kept.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.overwriteExisting).onChange(async (value) => {
        this.plugin.settings.overwriteExisting = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Reveal after export").setDesc("Open the exported file location in the system file manager.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.openAfterExport).onChange(async (value) => {
        this.plugin.settings.openAfterExport = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
