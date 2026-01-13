# Obsidian 插件集合

本仓库包含三个桌面端 Obsidian 插件的打包文件与（部分）源码：
- `autoupload_export/`：提供含图片上传的导出功能，带 TypeScript 源码。
- `obsidian-image-auto-upload-plugin/`：自动上传图片（仅打包产物）。
- `obsidian-enhancing-export/`：增强导出并支持 Pandoc/Lua 过滤（仅打包产物）。

## 快速开始（autoupload_export）
1. 将目录复制到 Obsidian 插件目录：`<vault>/.obsidian/plugins/autoupload_export`。
2. 在 Obsidian 中启用插件，功能入口：
   - 功能区图标 “Export note with uploaded images”。
   - 命令面板命令同名。
   - 文件右键菜单 “Export with image upload”。
3. 设置项（设置 → 第三方插件 → Export with Image Upload）：
   - `Export root folder`：导出根目录（相对 vault）。
   - `Upload server URL`：PicGo 兼容上传地址，默认 `http://127.0.0.1:36677/upload`。
   - `Use multipart upload`：启用 multipart/form-data 上传模式。
   - `Overwrite existing exports`：是否覆盖已存在文件。
   - `Reveal after export`：导出后在系统文件管理器中显示。

## 手动验证要点
- 导出包含本地图片与远程链接的笔记，确认图片被上传且链接替换为返回 URL。
- 关闭 `Overwrite existing exports` 后重复导出，确认不会覆盖。
- 检查 wiki 链接转换为标准 Markdown 链接（图片 wiki 链接保持不变）。
- `remoteServerMode`（multipart）与 JSON 上传模式各验证一次。
- 确认导出全程进度弹窗可见，进度条与提示实时更新，结束后关闭。
- `openAfterExport` 开启时，导出完成会在系统文件管理器中显示。
- 对 `obsidian-image-auto-upload-plugin`：拖入图片时仍自动上传。
- 对 `obsidian-enhancing-export`：执行 Markdown/HTML 导出，确认 Pandoc 路径检测与覆盖提示。

## 构建与开发（仅 autoupload_export 有源码）
当前仓库无 Node 配置，可按需引入（参考 Obsidian 官方模板）：
```bash
npm init -y
npm install --save-dev obsidian tslib typescript esbuild @types/node
```
示例脚本（需自建 `esbuild.config.mjs`）：
```json
{
  "scripts": {
    "build": "node esbuild.config.mjs",
    "dev": "npm run build -- --watch"
  }
}
```
构建输出应写回插件根：`main.js`、`manifest.json`、可选 `styles.css`。


## 代码风格（autoupload_export/main.ts）
- 语言/模块：TypeScript + ES module 导入，4 空格缩进，分号、单引号。
- 命名：类 PascalCase，变量/函数 camelCase，常量 UPPER_SNAKE_CASE。
- 类型：为参数与返回值显式标注；使用接口描述设置/DTO。
- 异步：优先 `async/await`，文件/网络操作使用 try/catch，并通过 `Notice` 显示错误。
- 路径：vault 侧使用 `normalizePath` 与 `path.posix`；写入前确保目录存在。
- 上传：区分 JSON 与 multipart 模式；当返回 URL 数量不一致时提示用户。
- 进度：导出过程中保持进度弹窗显示，更新百分比与提示，结束后关闭。
- 其他：保持多语言提示一致；默认设置集中在 `DEFAULT_SETTINGS`；导出后可通过 `shell.showItemInFolder` 打开。

## 文件与版本管理
- 源码：仅 `autoupload_export/main.ts` 可编辑；其他插件的 `main.js` 为打包产物，修改需重新构建源。
- 避免直接编辑 `data.json`（保存的设置/状态）。
- 若修改 TypeScript，记得同步 `manifest.json` 版本与元数据。
- 生成物（如 `main.js`、sourcemap）可按需加入 `.gitignore`，但本仓库当前跟踪 `main.js`。

## 忽略文件建议
见 `autoupload_export/.gitignore`，主要忽略 `node_modules/`、构建产物（除 `main.js`）、锁文件及 OS 垃圾文件。

## 环境与限制
- 仅桌面端：`manifest.json` 中 `isDesktopOnly: true`。
- 未提供 Cursor/Copilot 规则文件；如后续添加需同步到 AGENTS 说明。
- 无自动化测试，依赖手动验证。
- 当前版本：`autoupload-export` manifest `0.1.2`（以 `autoupload_export/manifest.json` 为准）。

如需进一步开发或发布，请在对应插件目录内初始化/使用 Git，并保持插件 ID 不变以兼容用户数据。
