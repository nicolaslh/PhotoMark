import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Calendar,
  Download,
  FileImage,
  FolderOpen,
  MapPin,
  Printer,
  RefreshCcw,
  Type
} from 'lucide-react';
import type { FontOption, GeocodeSettings, PhotoRecord, PrintSettings, WatermarkSettings } from '../shared/types';
import './styles.css';

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
  fit: 'contain'
};

const defaultGeocode: GeocodeSettings = {
  provider: 'amap',
  apiKey: ''
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
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [lastPdf, setLastPdf] = useState<string | null>(null);
  const selectedPhoto = photos.find((photo) => photo.id === selectedId) ?? photos[0] ?? null;
  const selectedFontId = watermark.fontPath ? `system:${watermark.fontPath}` : `standard:${watermark.fontFamily}`;

  const watermarkText = useMemo(
    () => (selectedPhoto ? renderWatermarkText(watermark.template, selectedPhoto) : ''),
    [selectedPhoto, watermark.template]
  );

  const paperSize = useMemo(() => getPaperSize(print), [print]);

  useEffect(() => {
    if (!selectedId && photos.length > 0) setSelectedId(photos[0].id);
  }, [photos, selectedId]);

  useEffect(() => {
    window.photoPrint.listFonts().then(setFonts).catch(() => undefined);
  }, []);

  useEffect(() => {
    localStorage.setItem('photomark-geocode', JSON.stringify(geocode));
  }, [geocode]);

  async function handleImport(): Promise<void> {
    setBusyLabel('正在读取照片信息');
    try {
      const imported = await window.photoPrint.selectPhotos();
      if (imported.length === 0) return;
      setPhotos((current) => mergePhotos(current, imported));
      setSelectedId(imported[0].id);
      resolveLocations(imported);
    } finally {
      setBusyLabel(null);
    }
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
    if (photos.length === 0) return;
    setBusyLabel('正在生成打印 PDF');
    try {
      const result = await window.photoPrint.generatePrintPdf(photos, watermark, print);
      setLastPdf(result.pdfPath);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handlePrint(): Promise<void> {
    if (photos.length === 0) return;
    setBusyLabel('正在准备系统打印');
    try {
      const result = await window.photoPrint.printPhotos(photos, watermark, print);
      setLastPdf(result.pdfPath);
    } finally {
      setBusyLabel(null);
    }
  }

  return (
    <main className="app-shell">
      <aside className="photo-rail">
        <div className="rail-header">
          <div>
            <p className="eyebrow">Photo Print</p>
            <h1>照片打印助手</h1>
          </div>
          <button className="icon-button primary" title="导入照片" onClick={handleImport}>
            <FolderOpen size={18} />
          </button>
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

        <div className="rail-actions">
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
            <button className="text-button" disabled={photos.length === 0} onClick={handleGeneratePdf}>
              <Download size={16} />
              生成 PDF
            </button>
            <button className="text-button primary" disabled={photos.length === 0} onClick={handlePrint}>
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
              <div className="print-image-area">
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

function loadGeocodeSettings(): GeocodeSettings {
  try {
    const saved = localStorage.getItem('photomark-geocode');
    return saved ? { ...defaultGeocode, ...JSON.parse(saved) } : defaultGeocode;
  } catch {
    return defaultGeocode;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
