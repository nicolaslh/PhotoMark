import { contextBridge, ipcRenderer } from 'electron';
import type { GpsPoint, PhotoRecord, PrintSettings, WatermarkSettings } from '../shared/types';

contextBridge.exposeInMainWorld('photoPrint', {
  selectPhotos: () => ipcRenderer.invoke('photos:select'),
  reverseGeocode: (gps: GpsPoint) => ipcRenderer.invoke('geo:reverse', gps),
  generatePrintPdf: (
    photos: PhotoRecord[],
    watermark: WatermarkSettings,
    print: PrintSettings
  ) => ipcRenderer.invoke('print:generate-pdf', { photos, watermark, print }),
  printPhotos: (photos: PhotoRecord[], watermark: WatermarkSettings, print: PrintSettings) =>
    ipcRenderer.invoke('print:start', { photos, watermark, print }),
  openPath: (path: string) => ipcRenderer.invoke('files:open-path', path)
});
