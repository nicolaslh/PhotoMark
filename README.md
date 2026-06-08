# 照片打印助手

Electron MVP for photo printing with temporary date/location watermarks.

## 当前能力

- 导入 JPG、PNG、WEBP、TIFF、HEIC/HEIF 照片。
- 读取 EXIF 拍摄时间，失败时回退到文件创建时间。
- 读取 EXIF GPS 经纬度。
- 联网逆地理编码，将经纬度转换为城市信息。
- 水印只在预览、临时 PDF、打印阶段叠加，不修改原图。
- 支持批量生成打印 PDF。
- 支持调用系统打印。
- 支持水印字体、字号、颜色、透明度和位置设置。

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

## 注意事项

- HEIC/HEIF 会在应用内部临时转换为 JPEG 参与预览和打印，原文件不会被写入。
- 城市解析需要联网，并会在本地缓存近似经纬度结果。
- 当前 MVP 的 PDF 字体使用内置标准字体：Helvetica、Times Roman、Courier。
- 打印链路优先生成临时 PDF，再交给系统打印，以便保持跨平台尺寸一致性。
