import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { exiftool } from 'exiftool-vendored';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import type {
  GeocodeResult,
  GpsPoint,
  PhotoRecord,
  PrintSettings,
  WatermarkSettings
} from '../shared/types';

const IMAGE_FILTERS = [
  { name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff'] }
];

const PAPER_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 }
};

let mainWindow: BrowserWindow | null = null;
let geocodeCache: Record<string, GeocodeResult> = {};

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1100,
    minHeight: 720,
    title: '照片打印助手',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  await loadGeocodeCache();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await exiftool.end();
});

ipcMain.handle('photos:select', async () => {
  if (!mainWindow) return [];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择照片',
    filters: IMAGE_FILTERS,
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled) return [];

  const photos = await Promise.all(result.filePaths.map((filePath) => inspectPhoto(filePath)));
  return photos;
});

ipcMain.handle('geo:reverse', async (_event, gps: GpsPoint) => reverseGeocode(gps));

ipcMain.handle(
  'print:generate-pdf',
  async (
    _event,
    payload: { photos: PhotoRecord[]; watermark: WatermarkSettings; print: PrintSettings }
  ) => {
    const pdfPath = await generatePrintPdf(payload.photos, payload.watermark, payload.print);
    return { pdfPath };
  }
);

ipcMain.handle(
  'print:start',
  async (
    _event,
    payload: { photos: PhotoRecord[]; watermark: WatermarkSettings; print: PrintSettings }
  ) => {
    const pdfPath = await generatePrintPdf(payload.photos, payload.watermark, payload.print);
    await printPdf(pdfPath);
    return { pdfPath };
  }
);

ipcMain.handle('files:open-path', async (_event, filePath: string) => {
  await shell.openPath(filePath);
});

async function inspectPhoto(filePath: string): Promise<PhotoRecord> {
  const extension = path.extname(filePath).replace('.', '').toLowerCase();
  const fileName = path.basename(filePath);

  try {
    const [tags, stats] = await Promise.all([exiftool.read(filePath), stat(filePath)]);
    const tagRecord = tags as unknown as Record<string, unknown>;
    const date = pickCapturedDate(tagRecord, stats.birthtime);
    const gps = pickGps(tagRecord);
    const previewDataUrl = await createPreviewDataUrl(filePath);

    return {
      id: `${filePath}-${stats.size}-${stats.mtimeMs}`,
      path: filePath,
      fileName,
      extension,
      capturedAt: date.value,
      capturedAtSource: date.source,
      gps,
      city: null,
      address: null,
      previewDataUrl,
      status: previewDataUrl ? 'ready' : 'preview-error',
      error: previewDataUrl ? undefined : '无法生成预览，但仍可尝试打印。'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取元数据失败';

    return {
      id: `${filePath}-${Date.now()}`,
      path: filePath,
      fileName,
      extension,
      capturedAt: null,
      capturedAtSource: 'unknown',
      gps: null,
      city: null,
      address: null,
      previewDataUrl: null,
      status: 'metadata-error',
      error: message
    };
  }
}

function pickCapturedDate(tags: Record<string, unknown>, fallback: Date): { value: string; source: string } {
  const candidates = [
    ['DateTimeOriginal', tags.DateTimeOriginal],
    ['CreateDate', tags.CreateDate],
    ['ModifyDate', tags.ModifyDate],
    ['FileCreateDate', tags.FileCreateDate]
  ] as const;

  for (const [source, value] of candidates) {
    const normalized = normalizeDate(value);
    if (normalized) return { value: normalized, source };
  }

  return { value: fallback.toISOString(), source: 'file-birthtime' };
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && 'toISOString' in value) {
    try {
      return (value as { toISOString: () => string }).toISOString();
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'string') {
    const parsed = new Date(value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return null;
}

function pickGps(tags: Record<string, unknown>): GpsPoint | null {
  const lat = Number(tags.GPSLatitude);
  const lon = Number(tags.GPSLongitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon };
  }
  return null;
}

async function createPreviewDataUrl(filePath: string): Promise<string | null> {
  try {
    const buffer = await createJpegBuffer(filePath, 1600);
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function createJpegBuffer(filePath: string, maxSize?: number): Promise<Buffer> {
  const ext = path.extname(filePath).toLowerCase();
  const isHeic = ext === '.heic' || ext === '.heif';
  const input = isHeic ? await convertHeicToJpeg(filePath) : filePath;
  let pipeline = sharp(input).rotate().jpeg({ quality: 92, mozjpeg: true });

  if (maxSize) {
    pipeline = pipeline.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true });
  }

  return pipeline.toBuffer();
}

async function convertHeicToJpeg(filePath: string): Promise<Buffer> {
  const convert = (await import('heic-convert')).default;
  const buffer = await readFile(filePath);
  const output = await convert({ buffer, format: 'JPEG', quality: 0.92 });
  if (output instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(output));
  }
  return Buffer.from(output);
}

async function loadGeocodeCache(): Promise<void> {
  try {
    const file = await geocodeCachePath();
    const raw = await readFile(file, 'utf-8');
    geocodeCache = JSON.parse(raw) as Record<string, GeocodeResult>;
  } catch {
    geocodeCache = {};
  }
}

async function saveGeocodeCache(): Promise<void> {
  const file = await geocodeCachePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(geocodeCache, null, 2), 'utf-8');
}

async function geocodeCachePath(): Promise<string> {
  return path.join(app.getPath('userData'), 'geocode-cache.json');
}

async function reverseGeocode(gps: GpsPoint): Promise<GeocodeResult> {
  const key = `${gps.lat.toFixed(4)},${gps.lon.toFixed(4)}`;
  if (geocodeCache[key]) return geocodeCache[key];

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(gps.lat));
  url.searchParams.set('lon', String(gps.lon));
  url.searchParams.set('zoom', '10');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'PhotoPrintAssistant/0.1 contact=local-app'
    }
  });

  if (!response.ok) {
    throw new Error(`地址解析失败：${response.status}`);
  }

  const data = (await response.json()) as {
    display_name?: string;
    address?: {
      city?: string;
      town?: string;
      village?: string;
      county?: string;
      state?: string;
      country?: string;
    };
  };
  const address = data.address ?? {};
  const city = address.city ?? address.town ?? address.village ?? address.county ?? address.state ?? null;
  const result = {
    city,
    address: data.display_name ?? null
  };

  geocodeCache[key] = result;
  await saveGeocodeCache();
  return result;
}

async function generatePrintPdf(
  photos: PhotoRecord[],
  watermark: WatermarkSettings,
  print: PrintSettings
): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(pickPdfFont(watermark.fontFamily));
  const paper = PAPER_SIZES[print.paper];
  const pageSize =
    print.orientation === 'portrait' ? [paper.width, paper.height] : [paper.height, paper.width];
  const margin = mmToPt(print.marginMm);
  const color = hexToRgb(watermark.color);

  for (const photo of photos) {
    const page = doc.addPage(pageSize as [number, number]);
    const imageBuffer = await createJpegBuffer(photo.path);
    const image = await doc.embedJpg(imageBuffer);
    const box = {
      x: margin,
      y: margin,
      width: page.getWidth() - margin * 2,
      height: page.getHeight() - margin * 2
    };
    const imageSize = fitRect(image.width, image.height, box.width, box.height, print.fit);
    const imageX = box.x + (box.width - imageSize.width) / 2;
    const imageY = box.y + (box.height - imageSize.height) / 2;

    page.drawImage(image, {
      x: imageX,
      y: imageY,
      width: imageSize.width,
      height: imageSize.height
    });

    const text = renderWatermarkText(watermark.template, photo);
    if (text.trim()) {
      const lines = text.split('\n');
      const lineHeight = watermark.fontSize * 1.22;
      const maxLineWidth = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, watermark.fontSize)));
      const textHeight = lineHeight * lines.length;
      const textPoint = getWatermarkPoint(
        watermark.position,
        page.getWidth(),
        page.getHeight(),
        maxLineWidth,
        textHeight,
        mmToPt(watermark.marginMm)
      );

      lines.forEach((line, index) => {
        page.drawText(line, {
          x: textPoint.x,
          y: textPoint.y + textHeight - lineHeight * (index + 1),
          size: watermark.fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
          opacity: watermark.opacity
        });
      });
    }
  }

  const bytes = await doc.save();
  const dir = path.join(app.getPath('temp'), 'photo-print-assistant');
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, `photo-print-${Date.now()}.pdf`);
  await writeFile(pdfPath, bytes);
  return pdfPath;
}

async function printPdf(pdfPath: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true
    }
  });

  await win.loadURL(pathToFileURL(pdfPath).toString());
  await new Promise<void>((resolve, reject) => {
    win.webContents.print({ printBackground: true }, (success, failureReason) => {
      win.close();
      if (success) resolve();
      else reject(new Error(failureReason || '打印已取消或失败'));
    });
  });
}

function pickPdfFont(fontFamily: WatermarkSettings['fontFamily']) {
  if (fontFamily === 'Courier') return StandardFonts.Courier;
  if (fontFamily === 'Times Roman') return StandardFonts.TimesRoman;
  return StandardFonts.Helvetica;
}

function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: PrintSettings['fit']
): { width: number; height: number } {
  const scale =
    mode === 'contain'
      ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);

  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale
  };
}

function getWatermarkPoint(
  position: WatermarkSettings['position'],
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  textHeight: number,
  margin: number
): { x: number; y: number } {
  if (position === 'top-left') return { x: margin, y: pageHeight - margin - textHeight };
  if (position === 'top-right') return { x: pageWidth - margin - textWidth, y: pageHeight - margin - textHeight };
  if (position === 'bottom-right') return { x: pageWidth - margin - textWidth, y: margin };
  if (position === 'center') return { x: (pageWidth - textWidth) / 2, y: (pageHeight - textHeight) / 2 };
  return { x: margin, y: margin };
}

function renderWatermarkText(template: string, photo: PhotoRecord): string {
  const date = photo.capturedAt ? formatDate(photo.capturedAt) : '';
  return template
    .replaceAll('{date}', date)
    .replaceAll('{city}', photo.city ?? '')
    .replaceAll('{address}', photo.address ?? '')
    .replaceAll('{filename}', photo.fileName)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const date = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${date} ${hours}:${minutes}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255
  };
}

function mmToPt(mm: number): number {
  return mm * 2.834645669;
}

setInterval(async () => {
  const dir = path.join(app.getPath('temp'), 'photo-print-assistant');
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 1 });
  } catch {
    // Temp cleanup is best effort only.
  }
}, 1000 * 60 * 60 * 12).unref();
