import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Calendar,
  Copy,
  Download,
  FileImage,
  FolderInput,
  FolderOpen,
  MapPin,
  Printer,
  RefreshCcw,
  Type
} from 'lucide-react';
import type { FontOption, GeocodeSettings, PhotoRecord, PrintSettings, WatermarkSettings } from '../shared/types';
import './styles.css';
import type { PrinterSummary } from '../shared/types';

const defaultWatermark: WatermarkSettings = {
  template: '{date}\n{city}',
  fontFamily: 'Helvetica',
  fontPath: null,
  fontSize: 18,
  color: '#ffffff',
  opacity: 0.92,
  position: 'bottom-left',
  marginMm: 10
};

const defaultPrint: PrintSettings = {
  paper: 'a4',
  orientation: 'portrait',
  marginMm: 12,
  fit: 'contain',
  photoSize: 'fit-page',
  customPhotoWidthMm: 101.6,
  customPhotoHeightMm: 152.4,
  printerName: '',
  copies: 1,
  scalePercent: 100
};

const defaultGeocode: GeocodeSettings = {
  provider: 'amap',
  apiKey: ''
};

type SavedWatermarkTemplate = {
  id: string;
  name: string;
  watermark: WatermarkSettings;
};

type BatchQueueItem = {
  photoId: string;
  fileName: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'canceled';
  message?: string;
};

function App(): JSX.Element {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [watermark, setWatermark] = useState(defaultWatermark);
  const [print, setPrint] = useState(defaultPrint);
  const [geocode, setGeocode] = useState<GeocodeSettings>(loadGeocodeSettings);
  const [fonts, setFonts] = useState<FontOption[]>([
    { id: 'standard:Helvetica', family: 'Helvetica', path: null, source: 'standard' },
    { id: 'standard:Times Roman', family: 'Times Roman', path: null, source: 'standard' },
    { id: 'standard:Courier', family: 'Courier', path: null, source: 'standard' }
  ]);
  const [printers, setPrinters] = useState<PrinterSummary[]>([]);
  const [templates, setTemplates] = useState<SavedWatermarkTemplate[]>(loadWatermarkTemplates);
  const [templateName, setTemplateName] = useState('默认水印');
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [lastPdf, setLastPdf] = useState<string | null>(null);
  const selectedPhoto = photos.find((photo) => photo.id === selectedId) ?? photos[0] ?? null;
  const selectedFontId = watermark.fontPath ? `system:${watermark.fontPath}` : `standard:${watermark.fontFamily}`;

  const watermarkText = useMemo(
    () => (selectedPhoto ? renderWatermarkText(watermark.template, selectedPhoto) : ''),
    [selectedPhoto, watermark.template]
  );

  const paperSize = useMemo(() => getPaperSize(print), [print]);
  const photoAreaStyle = useMemo(
    () => getPhotoAreaStyle(print, selectedPhoto),
    [print, selectedPhoto]
  );

  useEffect(() => {
    if (!selectedId && photos.length > 0) setSelectedId(photos[0].id);
  }, [photos, selectedId]);

  useEffect(() => {
    window.photoPrint.listFonts().then(setFonts).catch(() => undefined);
    refreshPrinters();
    return window.photoPrint.onBatchProgress((event) => {
      setQueue((current) =>
        current.map((item) =>
          item.photoId === event.photoId
            ? { ...item, status: event.status, message: event.message }
            : item
        )
      );
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('photomark-geocode', JSON.stringify(geocode));
  }, [geocode]);

  useEffect(() => {
    localStorage.setItem('photomark-watermark-templates', JSON.stringify(templates));
  }, [templates]);

  async function handleImport(): Promise<void> {
    setBusyLabel('正在读取照片信息');
    try {
      const imported = await window.photoPrint.selectPhotos();
      acceptImportedPhotos(imported);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleImportFolder(): Promise<void> {
    setBusyLabel('正在扫描照片文件夹');
    try {
      const imported = await window.photoPrint.selectPhotoFolder();
      acceptImportedPhotos(imported);
    } finally {
      setBusyLabel(null);
    }
  }

  function acceptImportedPhotos(imported: PhotoRecord[]): void {
    if (imported.length === 0) return;
    setPhotos((current) => mergePhotos(current, imported));
    setSelectedId(imported[0].id);
    resolveLocations(imported);
  }

  async function resolveLocations(targetPhotos = photos): Promise<void> {
    const withGps = targetPhotos.filter((photo) => photo.gps && !photo.city);
    if (withGps.length === 0) return;

    setBusyLabel('正在解析城市信息');
    for (const photo of withGps) {
      try {
        const result = await window.photoPrint.reverseGeocode(photo.gps!, geocode);
        setPhotos((current) =>
          current.map((item) =>
            item.id === photo.id ? { ...item, city: result.city, address: result.address } : item
          )
        );
      } catch {
        setPhotos((current) =>
          current.map((item) =>
            item.id === photo.id ? { ...item, city: '地址解析失败', address: null } : item
          )
        );
      }
    }
    setBusyLabel(null);
  }

  async function handleGeneratePdf(): Promise<void> {
    await startBatch('pdf');
  }

  async function handlePrint(): Promise<void> {
    await startBatch('print');
  }

  async function startBatch(mode: 'pdf' | 'print'): Promise<void> {
    if (photos.length === 0) return;
    const jobId = `job-${Date.now()}`;
    setCurrentJobId(jobId);
    setQueue(
      photos.map((photo) => ({
        photoId: photo.id,
        fileName: photo.fileName,
        status: 'pending'
      }))
    );
    setBusyLabel(mode === 'pdf' ? '正在生成打印 PDF' : '正在准备系统打印');

    try {
      const result =
        mode === 'pdf'
          ? await window.photoPrint.generatePrintPdf(photos, watermark, print, jobId)
          : await window.photoPrint.printPhotos(photos, watermark, print, jobId);
      setLastPdf(result.pdfPath);
      if (result.failures.length > 0) {
        setBusyLabel(`完成，${result.failures.length} 张照片失败`);
        return;
      }
      setBusyLabel('批量任务完成');
    } catch (error) {
      setBusyLabel(error instanceof Error ? error.message : '批量任务失败');
    } finally {
      setCurrentJobId(null);
    }
  }

  async function cancelCurrentJob(): Promise<void> {
    if (!currentJobId) return;
    await window.photoPrint.cancelBatch(currentJobId);
    setQueue((current) =>
      current.map((item) =>
        item.status === 'pending' || item.status === 'processing'
          ? { ...item, status: 'canceled', message: '任务已取消' }
          : item
      )
    );
    setBusyLabel('正在取消任务');
  }

  async function refreshPrinters(): Promise<void> {
    const found = await window.photoPrint.listPrinters();
    setPrinters(found);
    const defaultPrinter = found.find((printer) => printer.isDefault);
    setPrint((current) =>
      current.printerName || !defaultPrinter ? current : { ...current, printerName: defaultPrinter.name }
    );
  }

  async function handleGenerateCalibrationPdf(): Promise<void> {
    setBusyLabel('正在生成校准页');
    try {
      const result = await window.photoPrint.generateCalibrationPdf(print);
      setLastPdf(result.pdfPath);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handlePrintCalibration(): Promise<void> {
    setBusyLabel('正在打印校准页');
    try {
      const result = await window.photoPrint.printCalibration(print);
      setLastPdf(result.pdfPath);
    } finally {
      setBusyLabel(null);
    }
  }

  function saveTemplate(): void {
    const name = templateName.trim() || '未命名模板';
    const id = `template-${Date.now()}`;
    setTemplates((current) => [...current, { id, name, watermark }]);
  }

  function applyTemplate(templateId: string): void {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setWatermark(template.watermark);
    setTemplateName(template.name);
  }

  function deleteTemplate(templateId: string): void {
    setTemplates((current) => current.filter((item) => item.id !== templateId));
  }

  return (
    <main className="app-shell">
      <aside className="photo-rail">
        <div className="rail-header">
          <div>
            <p className="eyebrow">Photo Print</p>
            <h1>照片打印助手</h1>
          </div>
          <div className="rail-header-actions">
            <button className="icon-button" title="导入文件夹" onClick={handleImportFolder}>
              <FolderInput size={18} />
            </button>
            <button className="icon-button primary" title="导入照片" onClick={handleImport}>
              <FolderOpen size={18} />
            </button>
          </div>
        </div>

        <div className="photo-list">
          {photos.length === 0 ? (
            <div className="empty-state">
              <FileImage size={34} />
              <p>导入 JPG、PNG 或 HEIC 照片开始。</p>
            </div>
          ) : (
            photos.map((photo) => (
              <button
                className={`photo-row ${photo.id === selectedPhoto?.id ? 'active' : ''}`}
                key={photo.id}
                onClick={() => setSelectedId(photo.id)}
              >
                <div className="thumb">
                  {photo.previewDataUrl ? <img src={photo.previewDataUrl} alt="" /> : <FileImage size={18} />}
                </div>
                <span>
                  <strong>{photo.fileName}</strong>
                  <small>{photo.city ?? (photo.gps ? '等待地址解析' : '无 GPS 信息')}</small>
                </span>
              </button>
            ))
          )}
        </div>

        {queue.length > 0 && (
          <div className="queue-panel">
            <div className="queue-header">
              <strong>批量任务</strong>
              <span>{queue.filter((item) => item.status === 'done').length}/{queue.length}</span>
            </div>
            <div className="queue-bar">
              <span
                style={{
                  width: `${Math.round((queue.filter((item) => item.status === 'done').length / queue.length) * 100)}%`
                }}
              />
            </div>
            <div className="queue-list">
              {queue.slice(0, 8).map((item) => (
                <div className={`queue-item ${item.status}`} key={item.photoId}>
                  <span>{item.fileName}</span>
                  <small>{formatQueueStatus(item)}</small>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rail-actions">
          {currentJobId && (
            <button className="text-button danger" onClick={cancelCurrentJob}>
              取消当前批次
            </button>
          )}
          <button className="text-button" disabled={photos.length === 0} onClick={() => resolveLocations()}>
            <RefreshCcw size={16} />
            重新解析地址
          </button>
        </div>
      </aside>

      <section className="preview-pane">
        <div className="toolbar">
          <div className="toolbar-copy">
            <span>{photos.length} 张照片</span>
            <strong>{selectedPhoto?.fileName ?? '未选择照片'}</strong>
          </div>
          <div className="toolbar-actions">
            <button className="text-button" disabled={photos.length === 0 || Boolean(currentJobId)} onClick={handleGeneratePdf}>
              <Download size={16} />
              生成 PDF
            </button>
            <button className="text-button primary" disabled={photos.length === 0 || Boolean(currentJobId)} onClick={handlePrint}>
              <Printer size={16} />
              打印
            </button>
          </div>
        </div>

        <div className="stage">
          {selectedPhoto?.previewDataUrl ? (
            <div
              className="paper-preview"
              style={{
                aspectRatio: `${paperSize.width} / ${paperSize.height}`,
                padding: `${Math.max(10, print.marginMm * 1.35)}px`
              }}
            >
              <div className="print-image-area" style={photoAreaStyle}>
                <img
                  src={selectedPhoto.previewDataUrl}
                  alt={selectedPhoto.fileName}
                  style={{ objectFit: print.fit === 'cover' ? 'cover' : 'contain' }}
                />
              </div>
              <div
                className={`watermark watermark-${watermark.position}`}
                style={{
                  color: watermark.color,
                  opacity: watermark.opacity,
                  fontFamily: watermark.fontFamily,
                  fontSize: `${Math.max(12, watermark.fontSize)}px`
                }}
              >
                {watermarkText.split('\n').map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
              <span className="paper-label">
                {print.paper.toUpperCase()} · {print.orientation === 'portrait' ? '纵向' : '横向'}
              </span>
            </div>
          ) : (
            <div className="preview-empty">
              <FileImage size={44} />
              <p>选择照片后显示水印预览。</p>
            </div>
          )}
        </div>

        <div className="status-strip">
          <span>{busyLabel ?? '就绪'}</span>
          {lastPdf && (
            <button className="link-button" onClick={() => window.photoPrint.openPath(lastPdf)}>
              打开最近生成的 PDF
            </button>
          )}
        </div>
      </section>

      <aside className="settings-panel">
        <section className="settings-section">
          <h2>
            <Type size={16} />
            水印
          </h2>
          <div className="template-tools">
            <label>
              模板名
              <input
                type="text"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
              />
            </label>
            <button className="text-button" onClick={saveTemplate}>
              <Copy size={15} />
              保存
            </button>
          </div>
          {templates.length > 0 && (
            <div className="template-list">
              {templates.map((template) => (
                <div className="template-row" key={template.id}>
                  <button className="link-button" onClick={() => applyTemplate(template.id)}>
                    {template.name}
                  </button>
                  <button className="link-button danger" onClick={() => deleteTemplate(template.id)}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
          <label>
            文本模板
            <textarea
              value={watermark.template}
              onChange={(event) => setWatermark({ ...watermark, template: event.target.value })}
              rows={4}
            />
          </label>
          <div className="token-row">
            <code>{'{date}'}</code>
            <code>{'{city}'}</code>
            <code>{'{filename}'}</code>
          </div>
          <label>
            字体
            <select
              value={selectedFontId}
              onChange={(event) => {
                const font = fonts.find((item) => item.id === event.target.value);
                if (!font) return;
                setWatermark({ ...watermark, fontFamily: font.family, fontPath: font.path });
              }}
            >
              {fonts.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.family}{font.source === 'standard' ? ' · 标准' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="field-grid">
            <label>
              字号
              <input
                type="number"
                min="10"
                max="72"
                value={watermark.fontSize}
                onChange={(event) => setWatermark({ ...watermark, fontSize: Number(event.target.value) })}
              />
            </label>
            <label>
              颜色
              <input
                type="color"
                value={watermark.color}
                onChange={(event) => setWatermark({ ...watermark, color: event.target.value })}
              />
            </label>
          </div>
          <label>
            透明度
            <input
              type="range"
              min="0.2"
              max="1"
              step="0.05"
              value={watermark.opacity}
              onChange={(event) => setWatermark({ ...watermark, opacity: Number(event.target.value) })}
            />
          </label>
          <label>
            位置
            <select
              value={watermark.position}
              onChange={(event) =>
                setWatermark({ ...watermark, position: event.target.value as WatermarkSettings['position'] })
              }
            >
              <option value="bottom-left">左下</option>
              <option value="bottom-right">右下</option>
              <option value="top-left">左上</option>
              <option value="top-right">右上</option>
              <option value="center">居中</option>
            </select>
          </label>
        </section>

        <section className="settings-section">
          <h2>
            <MapPin size={16} />
            地址解析
          </h2>
          <label>
            服务
            <select
              value={geocode.provider}
              onChange={(event) => setGeocode({ ...geocode, provider: event.target.value as GeocodeSettings['provider'] })}
            >
              <option value="amap">高德地图 · 国内优先</option>
              <option value="osm">OpenStreetMap · 备用</option>
            </select>
          </label>
          {geocode.provider === 'amap' && (
            <label>
              高德 Web 服务 Key
              <input
                type="password"
                value={geocode.apiKey}
                placeholder="amap web service key"
                onChange={(event) => setGeocode({ ...geocode, apiKey: event.target.value })}
              />
            </label>
          )}
        </section>

        <section className="settings-section">
          <h2>
            <Printer size={16} />
            打印
          </h2>
          <div className="field-grid">
            <label>
              打印机
              <select
                value={print.printerName}
                onChange={(event) => setPrint({ ...print, printerName: event.target.value })}
              >
                <option value="">系统默认</option>
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}{printer.isDefault ? ' · 默认' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              份数
              <input
                type="number"
                min="1"
                max="99"
                value={print.copies}
                onChange={(event) => setPrint({ ...print, copies: Number(event.target.value) })}
              />
            </label>
          </div>
          <div className="button-row">
            <button className="text-button" onClick={refreshPrinters}>
              <RefreshCcw size={16} />
              刷新打印机
            </button>
          </div>
          <div className="field-grid">
            <label>
              纸张
              <select value={print.paper} onChange={(event) => setPrint({ ...print, paper: event.target.value as PrintSettings['paper'] })}>
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </label>
            <label>
              方向
              <select
                value={print.orientation}
                onChange={(event) =>
                  setPrint({ ...print, orientation: event.target.value as PrintSettings['orientation'] })
                }
              >
                <option value="portrait">纵向</option>
                <option value="landscape">横向</option>
              </select>
            </label>
          </div>
          <label>
            照片尺寸
            <select
              value={print.photoSize}
              onChange={(event) => setPrint({ ...print, photoSize: event.target.value as PrintSettings['photoSize'] })}
            >
              <option value="fit-page">适应可打印区域</option>
              <option value="4r">4R · 4 x 6 in</option>
              <option value="5r">5R · 5 x 7 in</option>
              <option value="6r">6R · 6 x 8 in</option>
              <option value="custom">自定义尺寸</option>
            </select>
          </label>
          {print.photoSize === 'custom' && (
            <div className="field-grid">
              <label>
                宽 mm
                <input
                  type="number"
                  min="20"
                  max="1000"
                  step="0.1"
                  value={print.customPhotoWidthMm}
                  onChange={(event) => setPrint({ ...print, customPhotoWidthMm: Number(event.target.value) })}
                />
              </label>
              <label>
                高 mm
                <input
                  type="number"
                  min="20"
                  max="1000"
                  step="0.1"
                  value={print.customPhotoHeightMm}
                  onChange={(event) => setPrint({ ...print, customPhotoHeightMm: Number(event.target.value) })}
                />
              </label>
            </div>
          )}
          <div className="field-grid">
            <label>
              页边距 mm
              <input
                type="number"
                min="0"
                max="40"
                value={print.marginMm}
                onChange={(event) => setPrint({ ...print, marginMm: Number(event.target.value) })}
              />
            </label>
            <label>
              适配
              <select value={print.fit} onChange={(event) => setPrint({ ...print, fit: event.target.value as PrintSettings['fit'] })}>
                <option value="contain">完整显示</option>
                <option value="cover">填充裁切</option>
              </select>
            </label>
          </div>
          <label>
            尺寸校准 %
            <input
              type="range"
              min="95"
              max="105"
              step="0.1"
              value={print.scalePercent}
              onChange={(event) => setPrint({ ...print, scalePercent: Number(event.target.value) })}
            />
            <span className="hint">{print.scalePercent.toFixed(1)}%</span>
          </label>
          <div className="button-row">
            <button className="text-button" onClick={handleGenerateCalibrationPdf}>
              <Download size={16} />
              校准页 PDF
            </button>
            <button className="text-button" onClick={handlePrintCalibration}>
              <Printer size={16} />
              打印校准页
            </button>
          </div>
          <p className="hint">校准页包含 100mm 方框；量到偏差后调整尺寸校准百分比。</p>
        </section>

        <section className="settings-section metadata">
          <h2>
            <Calendar size={16} />
            当前照片
          </h2>
          <p>{selectedPhoto?.capturedAt ? formatDate(selectedPhoto.capturedAt) : '暂无拍摄时间'}</p>
          <h2>
            <MapPin size={16} />
            地址
          </h2>
          <p>{selectedPhoto?.city ?? '暂无城市信息'}</p>
        </section>
      </aside>
    </main>
  );
}

function mergePhotos(current: PhotoRecord[], incoming: PhotoRecord[]): PhotoRecord[] {
  const known = new Set(current.map((photo) => photo.path));
  return [...current, ...incoming.filter((photo) => !known.has(photo.path))];
}

function renderWatermarkText(template: string, photo: PhotoRecord): string {
  const date = photo.capturedAt ? formatDate(photo.capturedAt) : '';
  return template
    .replaceAll('{date}', date)
    .replaceAll('{city}', photo.city ?? '')
    .replaceAll('{address}', photo.address ?? '')
    .replaceAll('{filename}', photo.fileName)
    .trim();
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

function getPaperSize(print: PrintSettings): { width: number; height: number } {
  const base = print.paper === 'letter' ? { width: 612, height: 792 } : { width: 595, height: 842 };
  return print.orientation === 'portrait' ? base : { width: base.height, height: base.width };
}

function getPhotoAreaStyle(print: PrintSettings, photo: PhotoRecord | null): React.CSSProperties {
  if (print.photoSize === 'fit-page') {
    return { width: '100%', height: '100%' };
  }

  const paperMm = getPaperSizeMm(print);
  const size = getPhotoSizeMm(print);
  const isLandscape = photo?.previewDataUrl ? false : false;
  let width = size.width;
  let height = size.height;

  if (isLandscape && height > width) {
    [width, height] = [height, width];
  }

  return {
    width: `${Math.min(100, (width / paperMm.width) * 100)}%`,
    height: `${Math.min(100, (height / paperMm.height) * 100)}%`
  };
}

function getPaperSizeMm(print: PrintSettings): { width: number; height: number } {
  const base = print.paper === 'letter' ? { width: 215.9, height: 279.4 } : { width: 210, height: 297 };
  return print.orientation === 'portrait' ? base : { width: base.height, height: base.width };
}

function getPhotoSizeMm(print: PrintSettings): { width: number; height: number } {
  if (print.photoSize === '5r') return { width: 127, height: 177.8 };
  if (print.photoSize === '6r') return { width: 152.4, height: 203.2 };
  if (print.photoSize === 'custom') {
    return { width: print.customPhotoWidthMm, height: print.customPhotoHeightMm };
  }
  return { width: 101.6, height: 152.4 };
}

function loadGeocodeSettings(): GeocodeSettings {
  try {
    const saved = localStorage.getItem('photomark-geocode');
    return saved ? { ...defaultGeocode, ...JSON.parse(saved) } : defaultGeocode;
  } catch {
    return defaultGeocode;
  }
}

function loadWatermarkTemplates(): SavedWatermarkTemplate[] {
  try {
    const saved = localStorage.getItem('photomark-watermark-templates');
    return saved ? (JSON.parse(saved) as SavedWatermarkTemplate[]) : [];
  } catch {
    return [];
  }
}

function formatQueueStatus(item: BatchQueueItem): string {
  if (item.status === 'processing') return '处理中';
  if (item.status === 'done') return '完成';
  if (item.status === 'error') return item.message ? `失败：${item.message}` : '失败';
  if (item.status === 'canceled') return '已取消';
  return '等待';
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
