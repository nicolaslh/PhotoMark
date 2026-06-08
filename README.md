# 照片打印助手

Electron MVP for photo printing with temporary date/location watermarks.

## 当前能力

- 导入 JPG、PNG、WEBP、TIFF、HEIC/HEIF 照片。
- 读取 EXIF 拍摄时间，失败时回退到文件创建时间。
- 读取 EXIF GPS 经纬度。
- 联网逆地理编码，将经纬度转换为城市信息，默认使用高德地图 Web 服务，另有 OpenStreetMap 备用。
- 水印只在预览、临时 PDF、打印阶段叠加，不修改原图。
- 纸张级打印预览，按纸张、方向、边距和适配方式展示。
- 支持批量生成打印 PDF。
- 支持调用系统打印。
- 支持系统字体、字号、颜色、透明度和位置设置。

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
- 国内城市解析优先使用高德地图 Web 服务 API，需要在界面里填写 Web 服务 Key。
- 城市解析会在本地缓存近似经纬度结果。
- 字体列表来自系统字体目录，PDF 会嵌入所选 TTF/OTF 字体。
- 打印链路优先生成临时 PDF，再交给系统打印，以便保持跨平台尺寸一致性。
