import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { WebContents } from 'electron';
import { exiftool } from 'exiftool-vendored';
import fontkit from '@pdf-lib/fontkit';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import type {
  BatchProgressEvent,
  FontOption,
  GeocodeSettings,
  GeocodeResult,
  GpsPoint,
  ImportProgressEvent,
  PhotoRecord,
  PhotoAdjustments,
  PrintFailure,
  PrinterSummary,
  PrintSettings,
  PrintResult,
  WatermarkSettings
} from '../shared/types';

const IMAGE_FILTERS = [
  { name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff'] }
];
const IMAGE_EXTENSIONS = new Set(IMAGE_FILTERS[0].extensions);
const METADATA_TIMEOUT_MS = 30_000;
const PREVIEW_TIMEOUT_MS = 45_000;

const STANDARD_FONTS: FontOption[] = [
  { id: 'standard:Helvetica', family: 'Helvetica', path: null, source: 'standard' },
  { id: 'standard:Times Roman', family: 'Times Roman', path: null, source: 'standard' },
  { id: 'standard:Courier', family: 'Courier', path: null, source: 'standard' }
];

const PAPER_SIZES = {
  a3: { width: 841.89, height: 1190.55 },
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  'photo-4r': { width: 288, height: 432 },
  'photo-5r': { width: 360, height: 504 },
  'photo-6r': { width: 432, height: 576 }
};
const PHOTO_SIZES_MM = {
  '4r': { width: 101.6, height: 152.4 },
  '5r': { width: 127, height: 177.8 },
  '6r': { width: 152.4, height: 203.2 }
};
const DEFAULT_ADJUSTMENTS: PhotoAdjustments = {
  rotateDeg: 0,
  brightness: 1,
  crop: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  }
};

let mainWindow: BrowserWindow | null = null;
let geocodeCache: Record<string, GeocodeResult> = {};
const canceledJobs = new Set<string>();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1100,
    minHeight: 720,
    title: 'PhotoMark',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
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

ipcMain.handle('photos:select', async (event) => {
  if (!mainWindow) return [];

  sendImportProgress(event.sender, {
    mode: 'files',
    stage: 'dialog',
    index: 0,
    total: 0,
    message: '等待选择照片'
  });

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择照片',
    filters: IMAGE_FILTERS,
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled) return [];

  return importPhotos(result.filePaths, 'files', (progress) => sendImportProgress(event.sender, progress));
});

ipcMain.handle('photos:select-folder', async (event) => {
  if (!mainWindow) return [];

  sendImportProgress(event.sender, {
    mode: 'folder',
    stage: 'dialog',
    index: 0,
    total: 0,
    message: '等待选择照片文件夹'
  });

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择照片文件夹',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) return [];

  sendImportProgress(event.sender, {
    mode: 'folder',
    stage: 'scanning',
    index: 0,
    total: 0,
    path: result.filePaths[0],
    message: '正在扫描照片文件夹'
  });
  const filePaths = await collectImageFiles(result.filePaths[0]);
  return importPhotos(filePaths, 'folder', (progress) => sendImportProgress(event.sender, progress));
});

ipcMain.handle('fonts:list', async () => listFonts());

ipcMain.handle('printers:list', async () => listPrinters());

ipcMain.handle(
  'geo:reverse',
  async (_event, payload: { gps: GpsPoint; settings: GeocodeSettings }) =>
    reverseGeocode(payload.gps, payload.settings)
);

ipcMain.handle(
  'print:generate-pdf',
  async (
    event,
    payload: { photos: PhotoRecord[]; watermark: WatermarkSettings; print: PrintSettings; jobId: string }
  ) => {
    try {
      return await generatePrintPdf(
        payload.photos,
        payload.watermark,
        payload.print,
        payload.jobId,
        (progress) => event.sender.send('batch:progress', progress)
      );
    } finally {
      canceledJobs.delete(payload.jobId);
    }
  }
);

ipcMain.handle(
  'print:start',
  async (
    event,
    payload: { photos: PhotoRecord[]; watermark: WatermarkSettings; print: PrintSettings; jobId: string }
  ) => {
    try {
      const result = await generatePrintPdf(
        payload.photos,
        payload.watermark,
        payload.print,
        payload.jobId,
        (progress) => event.sender.send('batch:progress', progress)
      );
      await printPdf(result.pdfPath, payload.print);
      return result;
    } finally {
      canceledJobs.delete(payload.jobId);
    }
  }
);

ipcMain.handle('batch:cancel', async (_event, payload: { jobId: string }) => {
  canceledJobs.add(payload.jobId);
});

ipcMain.handle('print:calibration-pdf', async (_event, payload: { print: PrintSettings }) => {
  const pdfPath = await generateCalibrationPdf(payload.print);
  return { pdfPath, failures: [] };
});

ipcMain.handle('print:calibration-start', async (_event, payload: { print: PrintSettings }) => {
  const pdfPath = await generateCalibrationPdf(payload.print);
  await printPdf(pdfPath, payload.print);
  return { pdfPath, failures: [] };
});

ipcMain.handle('files:open-path', async (_event, filePath: string) => {
  await shell.openPath(filePath);
});

type ImportProgressReporter = (event: ImportProgressEvent) => void;

type InspectPhotoContext = {
  mode: ImportProgressEvent['mode'];
  index: number;
  total: number;
  onProgress?: ImportProgressReporter;
};

function sendImportProgress(sender: WebContents, progress: ImportProgressEvent): void {
  if (sender.isDestroyed()) return;
  sender.send('import:progress', progress);
}

async function importPhotos(
  filePaths: string[],
  mode: ImportProgressEvent['mode'],
  onProgress: ImportProgressReporter
): Promise<PhotoRecord[]> {
  const total = filePaths.length;
  onProgress({
    mode,
    stage: 'selected',
    index: 0,
    total,
    message: total > 0 ? `已找到 ${total} 张照片` : '没有找到可导入的照片'
  });

  const photos: PhotoRecord[] = [];
  for (let index = 0; index < filePaths.length; index += 1) {
    const photo = await inspectPhoto(filePaths[index], {
      mode,
      index: index + 1,
      total,
      onProgress
    });
    photos.push(photo);
  }

  onProgress({
    mode,
    stage: 'done',
    index: total,
    total,
    message: total > 0 ? `照片导入完成：${photos.length}/${total}` : '没有找到可导入的照片'
  });

  return photos;
}

function reportPhotoImportStage(
  context: InspectPhotoContext | undefined,
  stage: ImportProgressEvent['stage'],
  filePath: string,
  message?: string
): void {
  context?.onProgress?.({
    mode: context.mode,
    stage,
    index: context.index,
    total: context.total,
    fileName: path.basename(filePath),
    path: filePath,
    message
  });
}

async function inspectPhoto(filePath: string, context?: InspectPhotoContext): Promise<PhotoRecord> {
  const extension = path.extname(filePath).replace('.', '').toLowerCase();
  const fileName = path.basename(filePath);

  try {
    reportPhotoImportStage(context, 'metadata', filePath, '读取文件大小、修改时间、EXIF 拍摄时间和多种 GPS 字段');
    const stats = await stat(filePath);
    let metadataError: string | undefined;
    let tagRecord: Record<string, unknown> = {};

    try {
      const tags = await withTimeout(
        exiftool.read(filePath),
        METADATA_TIMEOUT_MS,
        `读取 EXIF 超时（超过 ${Math.round(METADATA_TIMEOUT_MS / 1000)} 秒）`
      );
      tagRecord = tags as unknown as Record<string, unknown>;
    } catch (error) {
      metadataError = error instanceof Error ? error.message : '读取 EXIF 失败';
      reportPhotoImportStage(context, 'warning', filePath, metadataError);
    }

    const date = pickCapturedDate(tagRecord, stats.birthtime);
    const gpsInfo = pickGps(tagRecord);
    const locationInfo = pickLocationText(tagRecord);
    let preview: { dataUrl: string; width: number | null; height: number | null } | null = null;
    let previewError: string | undefined;

    reportPhotoImportStage(context, 'preview', filePath, '生成预览图并读取图片尺寸');
    try {
      preview = await withTimeout(
        createPreview(filePath),
        PREVIEW_TIMEOUT_MS,
        `生成预览超时（超过 ${Math.round(PREVIEW_TIMEOUT_MS / 1000)} 秒）`
      );
    } catch (error) {
      previewError = error instanceof Error ? error.message : '无法生成预览';
      reportPhotoImportStage(context, 'warning', filePath, previewError);
    }

    const error = [metadataError, previewError].filter(Boolean).join('；') || undefined;
    const status = metadataError ? 'metadata-error' : preview ? 'ready' : 'preview-error';

    const photo: PhotoRecord = {
      id: `${filePath}-${stats.size}-${stats.mtimeMs}`,
      path: filePath,
      fileName,
      extension,
      fileSize: stats.size,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
      capturedAt: date.value,
      capturedAtSource: date.source,
      gps: gpsInfo?.point ?? null,
      gpsSource: gpsInfo?.source ?? null,
      city: locationInfo.city,
      address: locationInfo.address,
      locationSource: locationInfo.source,
      previewDataUrl: preview?.dataUrl ?? null,
      width: preview?.width ?? null,
      height: preview?.height ?? null,
      adjustments: DEFAULT_ADJUSTMENTS,
      status,
      error: error ?? (preview ? undefined : '无法生成预览，但仍可尝试打印。')
    };

    reportPhotoImportStage(
      context,
      'done',
      filePath,
      photo.status === 'ready' ? '照片信息读取完成' : photo.error
    );

    return photo;
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取元数据失败';
    reportPhotoImportStage(context, 'error', filePath, message);

    return {
      id: `${filePath}-${Date.now()}`,
      path: filePath,
      fileName,
      extension,
      fileSize: null,
      createdAt: null,
      modifiedAt: null,
      capturedAt: null,
      capturedAtSource: 'unknown',
      gps: null,
      gpsSource: null,
      city: null,
      address: null,
      locationSource: null,
      previewDataUrl: null,
      width: null,
      height: null,
      adjustments: DEFAULT_ADJUSTMENTS,
      status: 'metadata-error',
      error: message
    };
  }
}

async function collectImageFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectImageFiles(fullPath);
      if (!entry.isFile()) return [];
      const ext = path.extname(entry.name).replace('.', '').toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) ? [fullPath] : [];
    })
  );

  return nested.flat().sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
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

function pickGps(tags: Record<string, unknown>): { point: GpsPoint; source: string } | null {
  const direct = parseGpsPair(tags.GPSLatitude, tags.GPSLongitude, tags.GPSLatitudeRef, tags.GPSLongitudeRef);
  if (direct) return { point: direct, source: 'GPSLatitude/GPSLongitude' };

  const candidateKeys = [
    'GPSPosition',
    'GPSCoordinates',
    'GPSCoordinate',
    'GPSLocation',
    'Location',
    'GeolocationPosition',
    'Composite:GPSPosition',
    'Composite:GPSLatitude',
    'Composite:GPSLongitude'
  ];

  for (const key of candidateKeys) {
    const point = parseGpsValue(tags[key]);
    if (point) return { point, source: key };
  }

  const nestedKeys = ['LocationCreated', 'LocationShown', 'XMP:LocationCreated', 'XMP:LocationShown'];
  for (const key of nestedKeys) {
    const point = parseNestedGps(tags[key]);
    if (point) return { point, source: key };
  }

  const fallback = pickGpsFromNamedFields(tags);
  if (fallback) return fallback;

  return null;
}

function pickGpsFromNamedFields(tags: Record<string, unknown>): { point: GpsPoint; source: string } | null {
  const entries = Object.entries(tags);
  const latEntry = entries.find(([key]) => /(?:^|[:_])(?:gps)?lat(?:itude)?$/i.test(key) || /gps.*latitude/i.test(key));
  const lonEntry = entries.find(([key]) => /(?:^|[:_])(?:gps)?lon(?:gitude)?$/i.test(key) || /gps.*longitude/i.test(key));
  if (!latEntry || !lonEntry) return null;

  const point = parseGpsPair(latEntry[1], lonEntry[1]);
  return point ? { point, source: `${latEntry[0]}/${lonEntry[0]}` } : null;
}

function parseGpsPair(latValue: unknown, lonValue: unknown, latRef?: unknown, lonRef?: unknown): GpsPoint | null {
  const lat = parseCoordinate(latValue, latRef);
  const lon = parseCoordinate(lonValue, lonRef);
  return normalizeGpsPoint(lat, lon);
}

function parseGpsValue(value: unknown): GpsPoint | null {
  if (!value) return null;

  if (Array.isArray(value) && value.length >= 2) {
    return parseGpsPair(value[0], value[1]);
  }

  if (typeof value === 'object') {
    return parseNestedGps(value);
  }

  const text = String(value).trim();
  if (!text) return null;

  const directionalParts = text.match(/[+-]?\d+(?:\.\d+)?(?:\D+[+-]?\d+(?:\.\d+)?){0,2}\s*[NSWE]/gi);
  if (directionalParts && directionalParts.length >= 2) {
    const point = parseGpsPair(directionalParts[0], directionalParts[1]);
    if (point) return point;
  }

  const commaParts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const point = parseGpsPair(commaParts[0], commaParts[1]);
    if (point) return point;
  }

  const decimalMatches = text.match(/[+-]?\d+(?:\.\d+)?/g);
  if (decimalMatches && decimalMatches.length >= 2 && /[NSWE]/i.test(text)) {
    const latSegment = text.slice(0, text.toUpperCase().search(/[EW]/));
    const lonSegment = text.slice(text.toUpperCase().search(/[EW]/));
    const point = parseGpsPair(latSegment, lonSegment);
    if (point) return point;
  }

  if (decimalMatches && decimalMatches.length === 2) {
    return normalizeGpsPoint(Number(decimalMatches[0]), Number(decimalMatches[1]));
  }

  return null;
}

function parseNestedGps(value: unknown): GpsPoint | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return (
    parseGpsPair(record.GPSLatitude, record.GPSLongitude, record.GPSLatitudeRef, record.GPSLongitudeRef) ??
    parseGpsPair(record.Latitude, record.Longitude, record.LatitudeRef, record.LongitudeRef) ??
    parseGpsPair(record.lat, record.lon) ??
    parseGpsPair(record.latitude, record.longitude) ??
    parseGpsValue(record.GPSPosition) ??
    parseGpsValue(record.GPSCoordinates)
  );
}

function parseCoordinate(value: unknown, ref?: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return applyCoordinateRef(value, ref);

  const text = String(value).trim();
  if (!text) return null;
  const numbers = text.match(/[+-]?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (numbers.length === 0) return null;

  let coordinate = numbers[0];
  if (numbers.length >= 3 && /deg|°|'|"|min|sec/i.test(text)) {
    coordinate = numbers[0] + numbers[1] / 60 + numbers[2] / 3600;
  } else if (numbers.length >= 2 && /deg|°/i.test(text)) {
    coordinate = numbers[0] + numbers[1] / 60;
  }

  return applyCoordinateRef(coordinate, ref ?? text);
}

function applyCoordinateRef(value: number, ref?: unknown): number {
  const refText = String(ref ?? '').toUpperCase();
  if (refText.includes('S') || refText.includes('W')) return -Math.abs(value);
  return value;
}

function normalizeGpsPoint(lat: number | null, lon: number | null): GpsPoint | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

function pickLocationText(tags: Record<string, unknown>): { city: string | null; address: string | null; source: string | null } {
  const directCity = pickFirstText(tags, [
    'City',
    'IPTC:City',
    'XMP:City',
    'LocationCreatedCity',
    'LocationShownCity',
    'LocationCreatedSublocation',
    'LocationShownSublocation',
    'Sub-location',
    'SubLocation',
    'Province-State',
    'State',
    'Province',
    'Country-PrimaryLocationName',
    'Country',
    'CountryName'
  ]);
  const directAddress = pickFirstText(tags, [
    'Location',
    'XMP:Location',
    'GPSAreaInformation',
    'LocationCreatedName',
    'LocationShownName',
    'LocationCreatedSublocation',
    'LocationShownSublocation',
    'Sub-location',
    'SubLocation',
    'Caption-Abstract',
    'Description',
    'ImageDescription',
    'UserComment',
    'XPComment',
    'XPSubject'
  ]);

  const nested = pickNestedLocation(tags);
  const city = directCity?.value ?? nested.city;
  const address = directAddress?.value ?? nested.address;
  const source = [directCity?.key, directAddress?.key, nested.source].filter(Boolean).join('/') || null;
  return { city, address, source };
}

function pickFirstText(tags: Record<string, unknown>, keys: string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = normalizeText(tags[key]);
    if (value) return { key, value };
  }

  const patterns = keys.map((key) => key.replace(/[^a-z0-9]/gi, '').toLowerCase());
  for (const [key, raw] of Object.entries(tags)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!patterns.some((pattern) => normalizedKey.includes(pattern))) continue;
    const value = normalizeText(raw);
    if (value) return { key, value };
  }

  return null;
}

function pickNestedLocation(tags: Record<string, unknown>): { city: string | null; address: string | null; source: string | null } {
  const nestedKeys = ['LocationCreated', 'LocationShown', 'XMP:LocationCreated', 'XMP:LocationShown'];
  for (const key of nestedKeys) {
    const raw = tags[key];
    if (!raw) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const record = value as Record<string, unknown>;
      const city =
        normalizeText(record.City) ??
        normalizeText(record.Sublocation) ??
        normalizeText(record.ProvinceState) ??
        normalizeText(record.Province) ??
        normalizeText(record.State) ??
        normalizeText(record.CountryName) ??
        normalizeText(record.Country);
      const address =
        normalizeText(record.Name) ??
        normalizeText(record.Sublocation) ??
        normalizeText(record.Location) ??
        normalizeText(record.Address);
      if (city || address) return { city, address, source: key };
    }
  }

  return { city: null, address: null, source: null };
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).find(Boolean) ?? null;
  }
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  if (!text || text === '-' || text.toLowerCase() === 'unknown') return null;
  return text;
}

async function createPreview(filePath: string): Promise<{ dataUrl: string; width: number | null; height: number | null } | null> {
  try {
    const buffer = await createJpegBuffer(filePath, 1600);
    const metadata = await sharp(buffer).metadata();
    return {
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      width: metadata.width ?? null,
      height: metadata.height ?? null
    };
  } catch {
    return null;
  }
}

async function createJpegBuffer(
  filePath: string,
  maxSize?: number,
  adjustments: PhotoAdjustments = DEFAULT_ADJUSTMENTS
): Promise<Buffer> {
  const ext = path.extname(filePath).toLowerCase();
  const isHeic = ext === '.heic' || ext === '.heif';
  const input = isHeic ? await convertHeicToJpeg(filePath) : filePath;
  let pipeline = sharp(input).rotate();
  const metadata = await pipeline.metadata();

  const cropRegion = getCropRegion(metadata.width, metadata.height, adjustments.crop);
  if (cropRegion) {
    pipeline = pipeline.extract(cropRegion);
  }

  if (adjustments.rotateDeg !== 0) {
    pipeline = pipeline.rotate(adjustments.rotateDeg);
  }

  if (adjustments.brightness !== 1) {
    pipeline = pipeline.modulate({ brightness: clamp(adjustments.brightness, 0.2, 2) });
  }

  pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });

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

async function reverseGeocode(gps: GpsPoint, settings: GeocodeSettings): Promise<GeocodeResult> {
  const provider = settings.provider ?? 'amap';
  const key = `${provider}:${gps.lat.toFixed(4)},${gps.lon.toFixed(4)}`;
  if (geocodeCache[key]) return geocodeCache[key];

  const result = provider === 'amap' ? await reverseGeocodeAmap(gps, settings.apiKey) : await reverseGeocodeOsm(gps);

  geocodeCache[key] = result;
  await saveGeocodeCache();
  return result;
}

async function reverseGeocodeAmap(gps: GpsPoint, apiKey: string): Promise<GeocodeResult> {
  if (!apiKey.trim()) {
    throw new Error('请填写高德地图 Web 服务 API Key');
  }

  const location = await convertGpsToAmap(gps, apiKey);
  const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('location', location);
  url.searchParams.set('extensions', 'base');
  url.searchParams.set('radius', '1000');
  url.searchParams.set('output', 'json');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`高德地址解析失败：${response.status}`);

  const data = (await response.json()) as {
    status?: string;
    info?: string;
    regeocode?: {
      formatted_address?: string;
      addressComponent?: {
        province?: string;
        city?: string | string[];
        district?: string;
      };
    };
  };

  if (data.status !== '1' || !data.regeocode) {
    throw new Error(data.info || '高德地址解析失败');
  }

  const component = data.regeocode.addressComponent ?? {};
  const rawCity = Array.isArray(component.city) ? '' : component.city;
  const city = rawCity || component.district || component.province || null;

  return {
    city,
    address: data.regeocode.formatted_address ?? null
  };
}

async function convertGpsToAmap(gps: GpsPoint, apiKey: string): Promise<string> {
  const url = new URL('https://restapi.amap.com/v3/assistant/coordinate/convert');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('locations', `${gps.lon},${gps.lat}`);
  url.searchParams.set('coordsys', 'gps');
  url.searchParams.set('output', 'json');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`高德坐标转换失败：${response.status}`);

  const data = (await response.json()) as { status?: string; info?: string; locations?: string };
  if (data.status !== '1' || !data.locations) {
    throw new Error(data.info || '高德坐标转换失败');
  }

  return data.locations.split(';')[0];
}

async function reverseGeocodeOsm(gps: GpsPoint): Promise<GeocodeResult> {
  const key = `osm:${gps.lat.toFixed(4)},${gps.lon.toFixed(4)}`;
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
  return {
    city,
    address: data.display_name ?? null
  };
}

async function generatePrintPdf(
  photos: PhotoRecord[],
  watermark: WatermarkSettings,
  print: PrintSettings,
  jobId: string,
  onProgress?: (event: BatchProgressEvent) => void
): Promise<PrintResult> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await embedWatermarkFont(doc, watermark);
  const addressFont = await embedWatermarkAddressFont(doc, watermark, font);
  const paper = getPaperSizePt(print);
  const pageSize =
    print.orientation === 'portrait' ? [paper.width, paper.height] : [paper.height, paper.width];
  const margin = mmToPt(print.marginMm);
  const failures: PrintFailure[] = [];

  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    if (canceledJobs.has(jobId)) {
      onProgress?.({
        jobId,
        index,
        total: photos.length,
        photoId: photo.id,
        fileName: photo.fileName,
        status: 'canceled',
        message: '任务已取消'
      });
      break;
    }

    onProgress?.({
      jobId,
      index,
      total: photos.length,
      photoId: photo.id,
      fileName: photo.fileName,
      status: 'processing'
    });

    try {
      const imageBuffer = await createJpegBuffer(photo.path, undefined, photo.adjustments);
      const image = await doc.embedJpg(imageBuffer);
      const page = doc.addPage(pageSize as [number, number]);
      const box = getPhotoPrintBox(page.getWidth(), page.getHeight(), margin, print, image.width >= image.height);
      const imageSize = fitRect(image.width, image.height, box.width, box.height, print.fit);
      const scale = clamp(print.scalePercent || 100, 50, 150) / 100;
      imageSize.width *= scale;
      imageSize.height *= scale;
      const imageX = box.x + (box.width - imageSize.width) / 2;
      const imageY = box.y + (box.height - imageSize.height) / 2;

      page.drawImage(image, {
        x: imageX,
        y: imageY,
        width: imageSize.width,
        height: imageSize.height
      });

      const watermarkLines = renderWatermarkLines(watermark, photo, font, addressFont);
      if (watermarkLines.length > 0) {
        const maxLineWidth = Math.max(...watermarkLines.map((line) => line.width));
        const textHeight = watermarkLines.reduce((sum, line) => sum + line.lineHeight, 0);
        const textPoint = getWatermarkPoint(
          watermark.position,
          page.getWidth(),
          page.getHeight(),
          maxLineWidth,
          textHeight,
          mmToPt(watermark.marginMm)
        );

        if (watermark.backgroundEnabled) {
          const padding = Math.max(4, watermark.fontSize * 0.45);
          page.drawRectangle({
            x: textPoint.x - padding,
            y: textPoint.y - padding * 0.7,
            width: maxLineWidth + padding * 2,
            height: textHeight + padding * 1.4,
            color: rgb(0.08, 0.11, 0.14),
            opacity: 0.42
          });
        }

        let lineOffset = 0;
        watermarkLines.forEach((line) => {
          lineOffset += line.lineHeight;
          page.drawText(line.text, {
            x: textPoint.x,
            y: textPoint.y + textHeight - lineOffset,
            size: line.fontSize,
            font: line.font,
            color: rgb(line.color.r, line.color.g, line.color.b),
            opacity: watermark.opacity
          });
        });
      }

      onProgress?.({
        jobId,
        index,
        total: photos.length,
        photoId: photo.id,
        fileName: photo.fileName,
        status: 'done'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败';
      failures.push({ photoId: photo.id, fileName: photo.fileName, message });
      onProgress?.({
        jobId,
        index,
        total: photos.length,
        photoId: photo.id,
        fileName: photo.fileName,
        status: 'error',
        message
      });
    }
  }

  if (doc.getPageCount() === 0) {
    throw new Error(failures[0]?.message || '没有可打印的照片');
  }

  const bytes = await doc.save();
  const dir = path.join(app.getPath('temp'), 'photo-print-assistant');
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, `photo-print-${Date.now()}.pdf`);
  await writeFile(pdfPath, bytes);
  return { pdfPath, failures };
}

async function generateCalibrationPdf(print: PrintSettings): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const paper = getPaperSizePt(print);
  const pageSize =
    print.orientation === 'portrait' ? [paper.width, paper.height] : [paper.height, paper.width];
  const page = doc.addPage(pageSize as [number, number]);
  const margin = mmToPt(print.marginMm);
  const square = mmToPt(100);
  const x = margin;
  const y = page.getHeight() - margin - square;

  page.drawText('PhotoMark print calibration', {
    x: margin,
    y: page.getHeight() - margin + 6,
    size: 14,
    font,
    color: rgb(0.1, 0.13, 0.16)
  });
  page.drawRectangle({
    x,
    y,
    width: square,
    height: square,
    borderColor: rgb(0.12, 0.44, 0.44),
    borderWidth: 1.5
  });
  page.drawText('100 mm', {
    x: x + square / 2 - 18,
    y: y - 18,
    size: 11,
    font,
    color: rgb(0.3, 0.35, 0.4)
  });
  page.drawText('Measure this square. Adjust scale percent if output is not 100 mm.', {
    x: margin,
    y: y - 42,
    size: 10,
    font,
    color: rgb(0.3, 0.35, 0.4)
  });

  const bytes = await doc.save();
  const dir = path.join(app.getPath('temp'), 'photo-print-assistant');
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, `photomark-calibration-${Date.now()}.pdf`);
  await writeFile(pdfPath, bytes);
  return pdfPath;
}

async function printPdf(pdfPath: string, print: PrintSettings): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true
    }
  });

  await win.loadURL(pathToFileURL(pdfPath).toString());
  await new Promise<void>((resolve, reject) => {
    win.webContents.print(
      {
        printBackground: true,
        deviceName: print.printerName || undefined,
        copies: Math.max(1, Math.min(99, Math.floor(print.copies || 1)))
      },
      (success, failureReason) => {
      win.close();
      if (success) resolve();
      else reject(new Error(failureReason || '打印已取消或失败'));
      }
    );
  });
}

async function embedWatermarkFont(doc: PDFDocument, watermark: WatermarkSettings) {
  if (watermark.fontPath) {
    const bytes = await readFile(watermark.fontPath);
    return doc.embedFont(bytes, { subset: true });
  }

  return doc.embedFont(pickPdfFont(watermark.fontFamily));
}

async function embedWatermarkAddressFont(
  doc: PDFDocument,
  watermark: WatermarkSettings,
  fallbackFont: Awaited<ReturnType<PDFDocument['embedFont']>>
) {
  if (watermark.addressFontPath) {
    const bytes = await readFile(watermark.addressFontPath);
    return doc.embedFont(bytes, { subset: true });
  }

  if (!watermark.addressFontFamily || watermark.addressFontFamily === watermark.fontFamily) {
    return fallbackFont;
  }

  return doc.embedFont(pickPdfFont(watermark.addressFontFamily));
}

function pickPdfFont(fontFamily: string) {
  if (fontFamily === 'Courier') return StandardFonts.Courier;
  if (fontFamily === 'Times Roman') return StandardFonts.TimesRoman;
  return StandardFonts.Helvetica;
}

async function listFonts(): Promise<FontOption[]> {
  const fontDirs = getSystemFontDirs();
  const systemFonts = await Promise.all(fontDirs.map((dir) => scanFontDir(dir)));
  const flattened = systemFonts.flat();
  const unique = new Map<string, FontOption>();

  for (const font of [...STANDARD_FONTS, ...flattened]) {
    if (!unique.has(font.id)) unique.set(font.id, font);
  }

  return [...unique.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'standard' ? -1 : 1;
    return a.family.localeCompare(b.family, 'zh-Hans-CN');
  });
}

function getSystemFontDirs(): string[] {
  if (process.platform === 'win32') {
    return ['C:\\Windows\\Fonts'];
  }

  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/Library/Fonts',
      path.join(os.homedir(), 'Library/Fonts')
    ];
  }

  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    path.join(os.homedir(), '.fonts'),
    path.join(os.homedir(), '.local/share/fonts')
  ];
}

async function listPrinters(): Promise<PrinterSummary[]> {
  if (!mainWindow) return [];

  const printers = await mainWindow.webContents.getPrintersAsync();
  return printers.map((printer) => {
    const printerInfo = printer as typeof printer & { status?: number; isDefault?: boolean };
    return {
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description || '',
      status: printerInfo.status ?? 0,
      isDefault: Boolean(printerInfo.isDefault)
    };
  });
}

async function scanFontDir(dir: string): Promise<FontOption[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return scanFontDir(fullPath);
        if (!entry.isFile() || !/\.(ttf|otf)$/i.test(entry.name)) return [];

        const family = path.basename(entry.name, path.extname(entry.name)).replace(/[-_]+/g, ' ');
        return [
          {
            id: `system:${fullPath}`,
            family,
            path: fullPath,
            source: 'system' as const
          }
        ];
      })
    );

    return nested.flat();
  } catch {
    return [];
  }
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

function getPhotoPrintBox(
  pageWidth: number,
  pageHeight: number,
  margin: number,
  print: PrintSettings,
  isLandscapePhoto: boolean
): { x: number; y: number; width: number; height: number } {
  const maxBox = {
    x: margin,
    y: margin,
    width: pageWidth - margin * 2,
    height: pageHeight - margin * 2
  };

  if (print.photoSize === 'fit-page') return maxBox;

  const photoSize = getPhotoSizeMm(print);
  let width = mmToPt(photoSize.width);
  let height = mmToPt(photoSize.height);

  if (isLandscapePhoto && height > width) {
    [width, height] = [height, width];
  }

  if (!isLandscapePhoto && width > height) {
    [width, height] = [height, width];
  }

  const scale = Math.min(1, maxBox.width / width, maxBox.height / height);
  width *= scale;
  height *= scale;

  return {
    x: margin + (maxBox.width - width) / 2,
    y: margin + (maxBox.height - height) / 2,
    width,
    height
  };
}

function getPhotoSizeMm(print: PrintSettings): { width: number; height: number } {
  if (print.photoSize === 'custom') {
    return {
      width: clamp(print.customPhotoWidthMm || 100, 20, 1000),
      height: clamp(print.customPhotoHeightMm || 150, 20, 1000)
    };
  }

  if (print.photoSize === '5r') return PHOTO_SIZES_MM['5r'];
  if (print.photoSize === '6r') return PHOTO_SIZES_MM['6r'];
  return PHOTO_SIZES_MM['4r'];
}

function getPaperSizePt(print: PrintSettings): { width: number; height: number } {
  if (print.paper === 'custom') {
    return {
      width: mmToPt(clamp(print.customPaperWidthMm || 210, 20, 1200)),
      height: mmToPt(clamp(print.customPaperHeightMm || 297, 20, 1200))
    };
  }

  return PAPER_SIZES[print.paper] ?? PAPER_SIZES.a4;
}

function getCropRegion(
  width: number | undefined,
  height: number | undefined,
  crop: PhotoAdjustments['crop']
): { left: number; top: number; width: number; height: number } | null {
  if (!width || !height) return null;

  const leftPct = clamp(crop.left, 0, 95);
  const rightPct = clamp(crop.right, 0, 95);
  const topPct = clamp(crop.top, 0, 95);
  const bottomPct = clamp(crop.bottom, 0, 95);
  const cropWidthPct = clamp(100 - leftPct - rightPct, 5, 100);
  const cropHeightPct = clamp(100 - topPct - bottomPct, 5, 100);
  const left = Math.floor((width * leftPct) / 100);
  const top = Math.floor((height * topPct) / 100);
  const cropWidth = Math.max(1, Math.floor((width * cropWidthPct) / 100));
  const cropHeight = Math.max(1, Math.floor((height * cropHeightPct) / 100));

  if (left === 0 && top === 0 && cropWidth === width && cropHeight === height) return null;

  return {
    left: Math.min(left, width - 1),
    top: Math.min(top, height - 1),
    width: Math.min(cropWidth, width - left),
    height: Math.min(cropHeight, height - top)
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

type EmbeddedWatermarkFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

function renderWatermarkLines(
  watermark: WatermarkSettings,
  photo: PhotoRecord,
  defaultFont: EmbeddedWatermarkFont,
  addressFont: EmbeddedWatermarkFont
): Array<{
  text: string;
  font: EmbeddedWatermarkFont;
  fontSize: number;
  lineHeight: number;
  width: number;
  color: { r: number; g: number; b: number };
}> {
  return watermark.template
    .split('\n')
    .map((templateLine) => {
      const isAddressLine = /\{city\}|\{address\}/.test(templateLine);
      const text = renderWatermarkText(templateLine, photo);
      const font = isAddressLine ? addressFont : defaultFont;
      const fontSize = isAddressLine ? watermark.addressFontSize : watermark.fontSize;
      const color = hexToRgb(isAddressLine ? watermark.addressColor : watermark.color);
      return {
        text,
        font,
        fontSize,
        lineHeight: fontSize * 1.22,
        width: font.widthOfTextAtSize(text, fontSize),
        color
      };
    })
    .filter((line) => line.text.trim());
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

setInterval(async () => {
  const dir = path.join(app.getPath('temp'), 'photo-print-assistant');
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 1 });
  } catch {
    // Temp cleanup is best effort only.
  }
}, 1000 * 60 * 60 * 12).unref();
