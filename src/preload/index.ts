import { contextBridge, ipcRenderer } from 'electron';
import type {
  BatchProgressEvent,
  GeocodeSettings,
  GpsPoint,
  PhotoRecord,
  PrintSettings,
  WatermarkSettings
} from '../shared/types';

contextBridge.exposeInMainWorld('photoPrint', {
  selectPhotos: () => ipcRenderer.invoke('photos:select'),
  selectPhotoFolder: () => ipcRenderer.invoke('photos:select-folder'),
  listFonts: () => ipcRenderer.invoke('fonts:list'),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  reverseGeocode: (gps: GpsPoint, settings: GeocodeSettings) => ipcRenderer.invoke('geo:reverse', { gps, settings }),
  generatePrintPdf: (
    photos: PhotoRecord[],
    watermark: WatermarkSettings,
    print: PrintSettings,
    jobId: string
  ) => ipcRenderer.invoke('print:generate-pdf', { photos, watermark, print, jobId }),
  printPhotos: (photos: PhotoRecord[], watermark: WatermarkSettings, print: PrintSettings, jobId: string) =>
    ipcRenderer.invoke('print:start', { photos, watermark, print, jobId }),
  cancelBatch: (jobId: string) => ipcRenderer.invoke('batch:cancel', { jobId }),
  onBatchProgress: (callback: (event: BatchProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: BatchProgressEvent) => callback(payload);
    ipcRenderer.on('batch:progress', listener);
    return () => ipcRenderer.removeListener('batch:progress', listener);
  },
  generateCalibrationPdf: (print: PrintSettings) => ipcRenderer.invoke('print:calibration-pdf', { print }),
  printCalibration: (print: PrintSettings) => ipcRenderer.invoke('print:calibration-start', { print }),
  openPath: (path: string) => ipcRenderer.invoke('files:open-path', path)
});
