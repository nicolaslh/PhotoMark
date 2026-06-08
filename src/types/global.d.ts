import type {
  GeocodeResult,
  GeocodeSettings,
  GpsPoint,
  FontOption,
  PhotoRecord,
  PrintResult,
  PrintSettings,
  WatermarkSettings
} from '../shared/types';

declare global {
  interface Window {
    photoPrint: {
      selectPhotos: () => Promise<PhotoRecord[]>;
      listFonts: () => Promise<FontOption[]>;
      reverseGeocode: (gps: GpsPoint, settings: GeocodeSettings) => Promise<GeocodeResult>;
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
