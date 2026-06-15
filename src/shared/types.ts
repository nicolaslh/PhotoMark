export type GpsPoint = {
  lat: number;
  lon: number;
};

export type PhotoRecord = {
  id: string;
  path: string;
  fileName: string;
  extension: string;
  fileSize: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  capturedAt: string | null;
  capturedAtSource: string;
  gps: GpsPoint | null;
  gpsSource: string | null;
  city: string | null;
  address: string | null;
  locationSource: string | null;
  previewDataUrl: string | null;
  width: number | null;
  height: number | null;
  adjustments: PhotoAdjustments;
  status: 'ready' | 'metadata-error' | 'preview-error';
  error?: string;
};

export type CropMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type PhotoAdjustments = {
  rotateDeg: 0 | 90 | 180 | 270;
  brightness: number;
  crop: CropMargins;
};

export type WatermarkPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

export type WatermarkSettings = {
  template: string;
  fontFamily: string;
  fontPath: string | null;
  fontSize: number;
  color: string;
  addressFontFamily: string;
  addressFontPath: string | null;
  addressFontSize: number;
  addressColor: string;
  opacity: number;
  position: WatermarkPosition;
  marginMm: number;
  backgroundEnabled: boolean;
};

export type PaperSize = 'a3' | 'a4' | 'a5' | 'letter' | 'legal' | 'photo-4r' | 'photo-5r' | 'photo-6r' | 'custom';

export type PrintSettings = {
  paper: PaperSize;
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  fit: 'contain' | 'cover' | 'adaptive';
  photoSize: 'fit-page' | '4r' | '5r' | '6r' | 'custom';
  customPhotoWidthMm: number;
  customPhotoHeightMm: number;
  customPaperWidthMm: number;
  customPaperHeightMm: number;
  printerName: string;
  copies: number;
  scalePercent: number;
};

export type GeocodeResult = {
  city: string | null;
  address: string | null;
};

export type GeocodeSettings = {
  provider: 'amap' | 'osm';
  apiKey: string;
};

export type FontOption = {
  id: string;
  family: string;
  path: string | null;
  source: 'standard' | 'system';
};

export type PrinterSummary = {
  name: string;
  displayName: string;
  description: string;
  status: number;
  isDefault: boolean;
};

export type PrintFailure = {
  photoId: string;
  fileName: string;
  message: string;
};

export type BatchProgressEvent = {
  jobId: string;
  index: number;
  total: number;
  photoId: string;
  fileName: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'canceled';
  message?: string;
};

export type ImportProgressEvent = {
  mode: 'files' | 'folder';
  stage: 'dialog' | 'scanning' | 'selected' | 'metadata' | 'preview' | 'done' | 'warning' | 'error';
  index: number;
  total: number;
  fileName?: string;
  path?: string;
  message?: string;
};

export type PrintResult = {
  pdfPath: string;
  failures: PrintFailure[];
};
