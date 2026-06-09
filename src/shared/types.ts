export type GpsPoint = {
  lat: number;
  lon: number;
};

export type PhotoRecord = {
  id: string;
  path: string;
  fileName: string;
  extension: string;
  capturedAt: string | null;
  capturedAtSource: string;
  gps: GpsPoint | null;
  city: string | null;
  address: string | null;
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
  opacity: number;
  position: WatermarkPosition;
  marginMm: number;
};

export type PrintSettings = {
  paper: 'a4' | 'letter';
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  fit: 'contain' | 'cover';
  photoSize: 'fit-page' | '4r' | '5r' | '6r' | 'custom';
  customPhotoWidthMm: number;
  customPhotoHeightMm: number;
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

export type PrintResult = {
  pdfPath: string;
  failures: PrintFailure[];
};
