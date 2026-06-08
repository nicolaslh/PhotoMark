import { contextBridge, ipcRenderer } from 'electron';
import type { GeocodeSettings, GpsPoint, PhotoRecord, PrintSettings, WatermarkSettings } from '../shared/types';

contextBridge.exposeInMainWorld('photoPrint', {
  selectPhotos: () => ipcRenderer.invoke('photos:select'),
  listFonts: () => ipcRenderer.invoke('fonts:list'),
  reverseGeocode: (gps: GpsPoint, settings: GeocodeSettings) => ipcRenderer.invoke('geo:reverse', { gps, settings }),
  generatePrintPdf: (
    photos: PhotoRecord[],
    watermark: WatermarkSettings,
    print: PrintSettings
  ) => ipcRenderer.invoke('print:generate-pdf', { photos, watermark, print }),
  printPhotos: (photos: PhotoRecord[], watermark: WatermarkSettings, print: PrintSettings) =>
    ipcRenderer.invoke('print:start', { photos, watermark, print }),
  openPath: (path: string) => ipcRenderer.invoke('files:open-path', path)
});
