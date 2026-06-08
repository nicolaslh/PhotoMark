import type {
  GeocodeResult,
  GpsPoint,
  PhotoRecord,
  PrintResult,
  PrintSettings,
  WatermarkSettings
} from '../shared/types';

declare global {
  interface Window {
    photoPrint: {
      selectPhotos: () => Promise<PhotoRecord[]>;
      reverseGeocode: (gps: GpsPoint) => Promise<GeocodeResult>;
      generatePrintPdf: (
        photos: PhotoRecord[],
        watermark: WatermarkSettings,
        print: PrintSettings
      ) => Promise<PrintResult>;
      printPhotos: (
        photos: PhotoRecord[],
        watermark: WatermarkSettings,
        print: PrintSettings
      ) => Promise<PrintResult>;
      openPath: (path: string) => Promise<void>;
    };
  }
}

export {};
