import type {
  BatchProgressEvent,
  GeocodeResult,
  GeocodeSettings,
  GpsPoint,
  FontOption,
  ImportProgressEvent,
  PhotoRecord,
  PrinterSummary,
  PrintResult,
  PrintSettings,
  WatermarkSettings
} from '../shared/types';

declare global {
  interface Window {
    photoPrint: {
      selectPhotos: () => Promise<PhotoRecord[]>;
      selectPhotoFolder: () => Promise<PhotoRecord[]>;
      listFonts: () => Promise<FontOption[]>;
      listPrinters: () => Promise<PrinterSummary[]>;
      reverseGeocode: (gps: GpsPoint, settings: GeocodeSettings) => Promise<GeocodeResult>;
      generatePrintPdf: (
        photos: PhotoRecord[],
        watermark: WatermarkSettings,
        print: PrintSettings,
        jobId: string
      ) => Promise<PrintResult>;
      printPhotos: (
        photos: PhotoRecord[],
        watermark: WatermarkSettings,
        print: PrintSettings,
        jobId: string
      ) => Promise<PrintResult>;
      printPhotosSystem: (
        photos: PhotoRecord[],
        watermark: WatermarkSettings,
        print: PrintSettings,
        jobId: string
      ) => Promise<PrintResult>;
      cancelBatch: (jobId: string) => Promise<void>;
      onBatchProgress: (callback: (event: BatchProgressEvent) => void) => () => void;
      onImportProgress: (callback: (event: ImportProgressEvent) => void) => () => void;
      generateCalibrationPdf: (print: PrintSettings) => Promise<PrintResult>;
      printCalibration: (print: PrintSettings) => Promise<PrintResult>;
      openPath: (path: string) => Promise<void>;
    };
  }
}

export {};
