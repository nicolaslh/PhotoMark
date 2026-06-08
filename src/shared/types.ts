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
  status: 'ready' | 'metadata-error' | 'preview-error';
  error?: string;
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

export type PrintResult = {
  pdfPath: string;
};
