# 照片打印助手

Electron MVP for photo printing with temporary date/location watermarks.

## 当前能力

- 导入 JPG、PNG、WEBP、TIFF、HEIC/HEIF 照片。
- 支持选择单张/多张照片，也支持递归导入整个照片文件夹。
- 读取 EXIF 拍摄时间，失败时回退到文件创建时间。
- 读取 EXIF GPS 经纬度。
- 联网逆地理编码，将经纬度转换为城市信息，默认使用高德地图 Web 服务，另有 OpenStreetMap 备用。
- 水印只在预览、临时 PDF、打印阶段叠加，不修改原图。
- 纸张级打印预览，按纸张、方向、边距和适配方式展示。
- 支持照片打印尺寸：适应可打印区域、4R、5R、6R、自定义毫米尺寸。
- 读取系统打印机列表，支持选择目标打印机和打印份数。
- 支持 100mm 打印校准页，并可通过尺寸校准百分比修正输出偏差。
- 支持批量生成打印 PDF。
- 支持批量任务队列，逐张显示等待、处理中、完成、失败或取消状态。
- 批量任务中单张照片失败不会中断整个批次，会记录失败列表。
- 支持取消当前批量任务。
- 支持调用系统打印。
- 支持系统字体、字号、颜色、透明度和位置设置。
- 支持保存、套用和删除本地水印模板。

## 启动

```bash
npm install
npm run dev
```

## 验证

```bash
npm run typecheck
npm run build
```

## 打包

```bash
npm run pack
npm run dist
```

- `pack` 生成未安装的应用目录，适合本地快速检查。
- `dist` 生成 Windows/macOS 安装包或压缩包，输出到 `release/`。
- 不要同时运行 `pack` 和 `dist`，它们会写入同一个 `release/` 目录。
- 当前还未配置自定义应用图标。
- Windows 安装包建议在 Windows 构建环境中执行 `npm run dist` 验证。

## macOS 签名和公证

项目已配置 hardened runtime 和 entitlements：

- `build/entitlements.mac.plist`
- `package.json` 的 `build.mac.hardenedRuntime`
- `package.json` 的 `build.mac.entitlements`
- `package.json` 的 `build.mac.entitlementsInherit`

签名/公证需要 Apple Developer 账号和 Developer ID Application 证书。

常用环境变量：

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_KEY="/absolute/path/AuthKey_XXXXXXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
npm run dist
```

如果本机钥匙串里没有可用 Developer ID Application 证书，`npm run dist` 会生成未签名包，并在日志中提示跳过签名。未签名包适合本地测试，不适合直接分发给普通 macOS 用户。

## 注意事项

- HEIC/HEIF 会在应用内部临时转换为 JPEG 参与预览和打印，原文件不会被写入。
- 国内城市解析优先使用高德地图 Web 服务 API，需要在界面里填写 Web 服务 Key。
- 城市解析会在本地缓存近似经纬度结果。
- 字体列表来自系统字体目录，PDF 会嵌入所选 TTF/OTF 字体。
- 打印链路优先生成临时 PDF，再交给系统打印，以便保持跨平台尺寸一致性。
- 打印机纸张、照片质量、无边距等高级能力仍取决于系统驱动。
- 尺寸校准建议先打印 100mm 校准页，再根据实际测量值调整缩放百分比。
