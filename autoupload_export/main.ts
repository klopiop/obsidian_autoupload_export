import { App, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, requestUrl } from 'obsidian';
import path from 'path';
import { promises as fs } from 'fs';
import { shell } from 'electron';

interface ExportSettings {
    exportRoot: string;
    uploadServer: string;
    remoteServerMode: boolean;
    overwriteExisting: boolean;
    openAfterExport: boolean;
}

interface ImageMatch {
    match: string;
    alt: string;
    originalLink: string;
    vaultPath?: string;
    absPath?: string;
    isLocal: boolean;
    finalUrl?: string;
}

const IMAGE_EXTENSIONS = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'webp',
    'bmp',
    'tiff',
    'ico'
]);

const DEFAULT_SETTINGS: ExportSettings = {
    exportRoot: 'ExportedNotes',
    uploadServer: 'http://127.0.0.1:36677/upload',
    remoteServerMode: false,
    overwriteExisting: true,
    openAfterExport: true
};

class ProgressModal extends Modal {
    private messageEl: HTMLElement;
    private barEl: HTMLProgressElement;
    private titleText: string;

    constructor(app: App, title: string) {
        super(app);
        this.titleText = title;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: this.titleText });
        this.barEl = contentEl.createEl('progress');
        this.barEl.max = 100;
        this.barEl.value = 0;
        this.barEl.style.width = '100%';
        this.barEl.style.marginBottom = '8px';
        this.messageEl = contentEl.createEl('div', { text: '' });
    }

    onClose(): void {
        this.contentEl.empty();
    }

    setMessage(message: string): void {
        if (this.messageEl) {
            this.messageEl.setText(message);
        }
    }

    setProgress(percent: number): void {
        if (this.barEl) {
            const bounded = Math.min(100, Math.max(0, percent));
            this.barEl.value = bounded;
        }
    }
}

export default class ExportWithImageUploadPlugin extends Plugin {
    settings: ExportSettings;

    async onload() {
        await this.loadSettings();
        this.addRibbonIcon('upload', 'Export note with uploaded images', () => this.exportActiveNote());
        this.addCommand({
            id: 'export-note-with-image-upload',
            name: 'Export note with uploaded images',
            callback: () => this.exportActiveNote()
        });
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu: Menu, file) => {
                if (file instanceof TFile) {
                    menu.addItem(item =>
                        item
                            .setTitle('Export with image upload')
                            .setIcon('upload')
                            .onClick(() => this.exportNote(file))
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

    private getBasePath(): string {
        const adapter = this.app.vault.adapter as any;
        if (adapter.getBasePath) {
            return adapter.getBasePath();
        }
        if (adapter.basePath) {
            return adapter.basePath;
        }
        throw new Error('File system adapter does not expose base path.');
    }

    private toAbsolute(vaultPath: string): string {
        return path.join(this.getBasePath(), vaultPath.split('/').join(path.sep));
    }

    private sanitizeName(name: string): string {
        return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
    }

    private async ensureFolder(folderPath: string) {
        const exists = await this.app.vault.adapter.exists(folderPath);
        if (!exists) {
            await this.app.vault.adapter.mkdir(folderPath);
        }
    }

    private resolveVaultPath(link: string, file: TFile): string | null {
        const cleaned = normalizePath(link);
        if (cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.startsWith('data:') || cleaned.startsWith('obsidian://')) {
            return null;
        }
        const currentDir = normalizePath(path.posix.dirname(file.path));
        const vaultPath = cleaned.startsWith('/')
            ? cleaned.replace(/^\//, '')
            : normalizePath(path.posix.join(currentDir, cleaned));
        return vaultPath;
    }

    private collectImages(content: string, file: TFile): ImageMatch[] {
        const results: ImageMatch[] = [];
        const markdownRegex = /!\[(.*?)\]\((.*?)\)/g;
        let mdMatch: RegExpExecArray | null;
        while ((mdMatch = markdownRegex.exec(content)) !== null) {
            const alt = mdMatch[1].trim();
            const rawLink = mdMatch[2].trim();
            const link = rawLink.split(' ')[0];
            const vaultPath = this.resolveVaultPath(link, file) || undefined;
            const absPath = vaultPath ? this.toAbsolute(vaultPath) : undefined;
            const isLocal = !!absPath && !link.startsWith('http') && !link.startsWith('data:') && !link.startsWith('obsidian://');
            results.push({
                match: mdMatch[0],
                alt: alt || path.basename(link),
                originalLink: link,
                vaultPath,
                absPath,
                isLocal
            });
        }
        const wikiRegex = /!\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g;
        let wkMatch: RegExpExecArray | null;
        while ((wkMatch = wikiRegex.exec(content)) !== null) {
            const target = wkMatch[1].trim();
            const alias = wkMatch[3] ? wkMatch[3].substring(1) : '';
            const alt = alias || path.basename(target);
            const dest = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
            let vaultPath: string | undefined;
            if (dest && IMAGE_EXTENSIONS.has(dest.extension.toLowerCase())) {
                vaultPath = dest.path;
            } else {
                const resolved = this.resolveVaultPath(target, file);
                vaultPath = resolved || undefined;
            }
            const absPath = vaultPath ? this.toAbsolute(vaultPath) : undefined;
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

    private convertWikiLinks(content: string): string {
        const wikiRegex = /(!)?\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g;
        return content.replace(wikiRegex, (match, isImage, target, heading, alias) => {
            if (isImage) return match;
            const display = alias ? String(alias).substring(1) : heading ? `${target}${heading}` : target;
            const sanitizedTarget = this.sanitizeName(target);
            const link = `${sanitizedTarget}.md${heading ?? ''}`;
            return `[${display}](${link})`;
        });
    }


    private parseUploadResult(data: any): string[] {
        if (!data) return [];
        if (Array.isArray(data)) return data as string[];
        if (Array.isArray(data?.result)) return data.result as string[];
        if (typeof data?.result === 'string') return [data.result];
        if (Array.isArray(data?.fullResult)) {
            // PicList full result items may contain imgUrl/url fields
            const urls = data.fullResult
                .map((item: any) => item?.imgUrl || item?.url || item?.imageUrl)
                .filter((v: any) => typeof v === 'string');
            if (urls.length) return urls;
        }
        if (typeof data?.url === 'string') return [data.url];
        return [];
    }

    private async uploadFiles(absPaths: string[]): Promise<string[]> {
        if (!absPaths.length) return [];
        if (this.settings.remoteServerMode) {
            const form = new FormData();
            for (const abs of absPaths) {
                const buffer = await fs.readFile(abs);
                const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                const file = new File([arrayBuffer], path.basename(abs));
                form.append('list', file);
            }
            const response = await fetch(this.settings.uploadServer, { method: 'POST', body: form });
            if (!response.ok) {
                throw new Error(`Upload failed with status ${response.status}`);
            }
            const data = await response.json();
            return this.parseUploadResult(data);
        }
        const response = await requestUrl({
            url: this.settings.uploadServer,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ list: absPaths })
        });
        const data = await response.json;
        return this.parseUploadResult(data);
    }

    private async processContent(content: string, file: TFile, progress?: ProgressModal): Promise<string> {
        let updated = content;
        const images = this.collectImages(content, file);
        const locals = images.filter(img => img.isLocal && img.absPath);
        if (locals.length) {
            progress?.setMessage(`上传图片中 (${locals.length})...`);
            progress?.setProgress(25);
            const uploadUrls = await this.uploadFiles(locals.map(i => i.absPath!));
            if (uploadUrls.length !== locals.length) {
                new Notice('图片上传数量与返回不一致，部分保持本地链接');
            }
            locals.forEach((item, index) => {
                if (uploadUrls[index]) {
                    item.finalUrl = uploadUrls[index];
                }
            });
            progress?.setMessage('图片上传完成，正在替换链接...');
            progress?.setProgress(40);
        }
        images.forEach(item => {
            const targetUrl = item.finalUrl || item.originalLink;
            const replacement = `![${item.alt}](${targetUrl})`;
            updated = updated.replace(item.match, replacement);
        });
        updated = this.convertWikiLinks(updated);
        progress?.setMessage('链接替换完成');
        progress?.setProgress(50);
        return updated;
    }

    private async exportNote(file: TFile) {
        const progress = new ProgressModal(this.app, '正在导出...');
        progress.open();
        progress.setMessage('读取文件内容...');
        progress.setProgress(10);
        try {
            const content = await this.app.vault.cachedRead(file);
            const sanitizedName = this.sanitizeName(file.basename);
            const exportDir = normalizePath(path.posix.join(this.settings.exportRoot, sanitizedName));
            progress.setMessage('准备导出目录...');
            progress.setProgress(15);
            await this.ensureFolder(exportDir);
            const targetName = `${sanitizedName}.md`;
            const exportPath = normalizePath(path.posix.join(exportDir, targetName));
            const exists = await this.app.vault.adapter.exists(exportPath);
            if (exists && !this.settings.overwriteExisting) {
                new Notice('目标文件已存在，未覆盖');
                progress.setMessage('导出已取消：目标存在');
                progress.setProgress(100);
                progress.close();
                return;
            }
            progress.setMessage('处理内容与上传图片...');
            progress.setProgress(20);
            const processed = await this.processContent(content, file, progress);
            progress.setMessage('写入导出文件...');
            progress.setProgress(70);
            await this.app.vault.adapter.write(exportPath, processed);
            if (this.settings.openAfterExport) {
                progress.setMessage('打开导出位置...');
                progress.setProgress(85);
                shell.showItemInFolder(this.toAbsolute(exportPath));
            }
            progress.setMessage('完成');
            progress.setProgress(100);
            new Notice(`导出成功：${exportPath}`);
        } catch (error) {
            console.error(error);
            progress.setMessage('导出失败');
            progress.setProgress(100);
            new Notice(`导出失败：${(error as Error).message}`);
        } finally {
            progress.close();
        }
    }

    async exportActiveNote() {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice('请先打开一个文件');
            return;
        }
        await this.exportNote(file);
    }
}

class ExportSettingTab extends PluginSettingTab {
    plugin: ExportWithImageUploadPlugin;

    constructor(app: App, plugin: ExportWithImageUploadPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Export root folder')
            .setDesc('Vault-relative path for exported notes.')
            .addText(text =>
                text
                    .setPlaceholder('ExportedNotes')
                    .setValue(this.plugin.settings.exportRoot)
                    .onChange(async value => {
                        this.plugin.settings.exportRoot = value || DEFAULT_SETTINGS.exportRoot;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Upload server URL')
            .setDesc('PicGo server upload endpoint.')
            .addText(text =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.uploadServer)
                    .setValue(this.plugin.settings.uploadServer)
                    .onChange(async value => {
                        this.plugin.settings.uploadServer = value || DEFAULT_SETTINGS.uploadServer;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Use multipart upload')
            .setDesc('Enable when your server expects multipart/form-data uploads.')
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.remoteServerMode).onChange(async value => {
                    this.plugin.settings.remoteServerMode = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Overwrite existing exports')
            .setDesc('If disabled, existing files will be kept.')
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.overwriteExisting).onChange(async value => {
                    this.plugin.settings.overwriteExisting = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Reveal after export')
            .setDesc('Open the exported file location in the system file manager.')
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.openAfterExport).onChange(async value => {
                    this.plugin.settings.openAfterExport = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}
