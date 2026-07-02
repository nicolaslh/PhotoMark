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
  RotateCcw,
  RotateCw,
  Scissors,
  Square,
  SquareCheck,
  Type
} from 'lucide-react';
import type { FontOption, GeocodeSettings, PhotoRecord, PrintSettings, WatermarkSettings } from '../shared/types';
import './styles.css';
import type { ImportProgressEvent, PrinterSummary } from '../shared/types';

const defaultWatermark: WatermarkSettings = {
  template: '{date}\n{city}',
  fontFamily: 'Helvetica',
  fontPath: null,
  fontSize: 18,
  color: '#ffffff',
  addressFontFamily: 'Helvetica',
  addressFontPath: null,
  addressFontSize: 18,
  addressColor: '#ffffff',
  opacity: 0.92,
  position: 'bottom-left',
  marginMm: 10,
  backgroundEnabled: false,
  customX: 10,
  customY: 90
};

const defaultPrint: PrintSettings = {
  paper: 'a4',
  orientation: 'portrait',
  marginMm: 12,
  fit: 'adaptive',
  photoSize: 'fit-page',
  customPhotoWidthMm: 101.6,
  customPhotoHeightMm: 152.4,
  customPaperWidthMm: 210,
  customPaperHeightMm: 297,
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

type WatermarkDragState = {
  isDragging: boolean;
  startX: number;
  startY: number;
  startXPercent: number;
  startYPercent: number;
};

function App(): JSX.Element {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
  const [busyDetail, setBusyDetail] = useState<string | null>(null);
  const [lastPdf, setLastPdf] = useState<string | null>(null);
  const [watermarkDrag, setWatermarkDrag] = useState<WatermarkDragState | null>(null);
  const paperPreviewRef = React.useRef<HTMLDivElement | null>(null);
  const selectedPhoto = photos.find((photo) => photo.id === selectedId) ?? photos[0] ?? null;
  const photosToPrint = selectedIds.size > 0 ? photos.filter((p) => selectedIds.has(p.id)) : photos;
  const selectedFontId = watermark.fontPath ? `system:${watermark.fontPath}` : `standard:${watermark.fontFamily}`;
  const selectedAddressFontId = watermark.addressFontPath
    ? `system:${watermark.addressFontPath}`
    : `standard:${watermark.addressFontFamily}`;

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
    const removeBatchProgress = window.photoPrint.onBatchProgress((event) => {
      setQueue((current) =>
        current.map((item) =>
          item.photoId === event.photoId
            ? { ...item, status: event.status, message: event.message }
            : item
        )
      );
    });
    const removeImportProgress = window.photoPrint.onImportProgress((event) => {
      setBusyLabel(formatImportProgressLabel(event));
      setBusyDetail(formatImportProgressDetail(event));
    });

    return () => {
      removeBatchProgress();
      removeImportProgress();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('photomark-geocode', JSON.stringify(geocode));
  }, [geocode]);

  useEffect(() => {
    localStorage.setItem('photomark-watermark-templates', JSON.stringify(templates));
  }, [templates]);

  async function handleImport(): Promise<void> {
    setBusyLabel('等待选择照片');
    setBusyDetail('可以选择单张或多张照片');
    try {
      const imported = await window.photoPrint.selectPhotos();
      acceptImportedPhotos(imported);
      if (imported.length === 0) {
        setBusyLabel('就绪');
        setBusyDetail('没有选择照片');
      }
    } catch (error) {
      setBusyLabel('导入照片失败');
      setBusyDetail(error instanceof Error ? error.message : '读取照片时发生未知错误');
    } finally {
      setTimeout(() => {
        setBusyLabel((current) => (current === '就绪' ? null : current));
      }, 1200);
    }
  }

  async function handleImportFolder(): Promise<void> {
    setBusyLabel('等待选择照片文件夹');
    setBusyDetail('会递归扫描支持的图片格式');
    try {
      const imported = await window.photoPrint.selectPhotoFolder();
      acceptImportedPhotos(imported);
      if (imported.length === 0) {
        setBusyLabel('就绪');
        setBusyDetail('没有找到可导入的照片');
      }
    } catch (error) {
      setBusyLabel('导入文件夹失败');
      setBusyDetail(error instanceof Error ? error.message : '扫描或读取照片时发生未知错误');
    } finally {
      setTimeout(() => {
        setBusyLabel((current) => (current === '就绪' ? null : current));
      }, 1200);
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

    setBusyLabel(`正在解析城市信息 0/${withGps.length}`);
    setBusyDetail('等待地址服务返回结果');
    for (let index = 0; index < withGps.length; index += 1) {
      const photo = withGps[index];
      setBusyLabel(`正在解析城市信息 ${index + 1}/${withGps.length}`);
      setBusyDetail(photo.fileName);
      try {
        const result = await window.photoPrint.reverseGeocode(photo.gps!, geocode);
        setPhotos((current) =>
          current.map((item) =>
            item.id === photo.id
              ? { ...item, city: result.city, address: result.address, locationSource: `${geocode.provider} reverse geocode` }
              : item
          )
        );
      } catch {
        setPhotos((current) =>
          current.map((item) =>
            item.id === photo.id ? { ...item, city: '地址解析失败', address: null, locationSource: null } : item
          )
        );
      }
    }
    setBusyLabel('地址解析完成');
    setBusyDetail(`${withGps.length} 张照片已处理`);
  }

  async function handleGeneratePdf(): Promise<void> {
    await startBatch('pdf');
  }

  async function handlePrint(): Promise<void> {
    await startBatch('print');
  }

  async function startBatch(mode: 'pdf' | 'print'): Promise<void> {
    const targetPhotos = photosToPrint;
    if (targetPhotos.length === 0) return;
    const jobId = `job-${Date.now()}`;
    setCurrentJobId(jobId);
    setQueue(
      targetPhotos.map((photo) => ({
        photoId: photo.id,
        fileName: photo.fileName,
        status: 'pending'
      }))
    );
    setBusyLabel(mode === 'pdf' ? '正在生成打印 PDF' : '正在准备系统打印');
    setBusyDetail(`${targetPhotos.length} 张照片等待处理`);

    try {
      const result =
        mode === 'pdf'
          ? await window.photoPrint.generatePrintPdf(targetPhotos, watermark, print, jobId)
          : await window.photoPrint.printPhotos(targetPhotos, watermark, print, jobId);
      setLastPdf(result.pdfPath);
      if (result.failures.length > 0) {
        setBusyLabel(`完成，${result.failures.length} 张照片失败`);
        setBusyDetail(`PDF 已生成：${result.pdfPath}`);
        setQueue((current) =>
          current.map((item) => {
            const failure = result.failures.find((f) => f.photoId === item.photoId);
            return failure ? { ...item, status: 'error' as const, message: failure.message } : item;
          })
        );
      } else {
        setBusyLabel('批量任务完成');
        setBusyDetail(`PDF 已生成：${result.pdfPath}`);
        setQueue((current) =>
          current.map((item) => ({ ...item, status: 'done' as const }))
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '批量任务失败';
      setBusyLabel('任务失败');
      setBusyDetail(errorMessage);
      setQueue((current) =>
        current.map((item) =>
          item.status === 'pending' ? { ...item, status: 'error' as const, message: errorMessage } : item
        )
      );
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
    setBusyDetail(currentJobId);
  }

  async function refreshPrinters(): Promise<void> {
    const found = await window.photoPrint.listPrinters();
    setPrinters(found);
    const defaultPrinter = found.find((printer) => printer.isDefault);
    setPrint((current) => {
      // 如果当前选择的打印机不在有效列表中，清除选择
      const isValidPrinter = current.printerName && found.some(p => p.name === current.printerName);
      if (!isValidPrinter) {
        // 自动选择默认打印机，如果没有默认则选择第一个
        const autoSelect = defaultPrinter?.name || (found.length > 0 ? found[0].name : '');
        return { ...current, printerName: autoSelect };
      }
      return current;
    });
  }

  async function handleGenerateCalibrationPdf(): Promise<void> {
    setBusyLabel('正在生成校准页');
    setBusyDetail('100mm 打印校准方框');
    try {
      const result = await window.photoPrint.generateCalibrationPdf(print);
      setLastPdf(result.pdfPath);
    } finally {
      setBusyLabel(null);
      setBusyDetail(null);
    }
  }

  async function handlePrintCalibration(): Promise<void> {
    setBusyLabel('正在打印校准页');
    setBusyDetail(print.printerName || '系统默认打印机');
    try {
      const result = await window.photoPrint.printCalibration(print);
      setLastPdf(result.pdfPath);
    } finally {
      setBusyLabel(null);
      setBusyDetail(null);
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
    setWatermark({ ...defaultWatermark, ...template.watermark });
    setTemplateName(template.name);
  }

  function deleteTemplate(templateId: string): void {
    setTemplates((current) => current.filter((item) => item.id !== templateId));
  }

  function togglePhotoSelection(photoId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }

  function selectAllPhotos(): void {
    setSelectedIds(new Set(photos.map((p) => p.id)));
  }

  function deselectAllPhotos(): void {
    setSelectedIds(new Set());
  }

  function updateSelectedPhoto(patch: Partial<PhotoRecord>): void {
    if (!selectedPhoto) return;
    setPhotos((current) =>
      current.map((photo) => (photo.id === selectedPhoto.id ? { ...photo, ...patch } : photo))
    );
  }

  function updateSelectedAdjustments(patch: Partial<PhotoRecord['adjustments']>): void {
    if (!selectedPhoto) return;
    updateSelectedPhoto({
      adjustments: {
        ...selectedPhoto.adjustments,
        ...patch
      }
    });
  }

  function updateCrop(side: keyof PhotoRecord['adjustments']['crop'], value: number): void {
    if (!selectedPhoto) return;
    updateSelectedAdjustments({
      crop: {
        ...selectedPhoto.adjustments.crop,
        [side]: value
      }
    });
  }

  function resetAdjustments(): void {
    updateSelectedAdjustments({
      rotateDeg: 0,
      brightness: 1,
      crop: { top: 0, right: 0, bottom: 0, left: 0 }
    });
  }

  function handleWatermarkMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
    if (watermark.position !== 'custom') return;
    if (!paperPreviewRef.current) return;
    
    const rect = paperPreviewRef.current.getBoundingClientRect();
    setWatermarkDrag({
      isDragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startXPercent: watermark.customX ?? 10,
      startYPercent: watermark.customY ?? 90
    });
  }

  React.useEffect(() => {
    if (!watermarkDrag?.isDragging) return;

    function handleMouseMove(event: MouseEvent): void {
      if (!paperPreviewRef.current) return;
      const rect = paperPreviewRef.current.getBoundingClientRect();
      const deltaX = event.clientX - watermarkDrag.startX;
      const deltaY = event.clientY - watermarkDrag.startY;
      const xPercent = Math.max(0, Math.min(100, watermarkDrag.startXPercent + (deltaX / rect.width) * 100));
      const yPercent = Math.max(0, Math.min(100, watermarkDrag.startYPercent + (deltaY / rect.height) * 100));
      setWatermark((prev) => ({
        ...prev,
        customX: xPercent,
        customY: yPercent
      }));
    }

    function handleMouseUp(): void {
      setWatermarkDrag(null);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [watermarkDrag]);

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

        <div className="photo-list-header">
          {photos.length > 0 && (
            <>
              <span className="selection-info">
                {selectedIds.size > 0 ? `已选 ${selectedIds.size}/${photos.length} 张` : `${photos.length} 张照片`}
              </span>
              <div className="selection-actions">
                <button className="link-button" onClick={selectAllPhotos}>全选</button>
                <button className="link-button" onClick={deselectAllPhotos}>取消全选</button>
              </div>
            </>
          )}
        </div>

        <div className="photo-list">
          {photos.length === 0 ? (
            <div className="empty-state">
              <FileImage size={34} />
              <p>导入 JPG、PNG 或 HEIC 照片开始。</p>
            </div>
          ) : (
            photos.map((photo) => (
              <div
                className={`photo-row ${photo.id === selectedPhoto?.id ? 'active' : ''} ${selectedIds.has(photo.id) ? 'selected' : ''}`}
                key={photo.id}
              >
                <button
                  className="photo-check"
                  onClick={(e) => { e.stopPropagation(); togglePhotoSelection(photo.id); }}
                  title={selectedIds.has(photo.id) ? '取消选择' : '选择打印'}
                >
                  {selectedIds.has(photo.id) ? <SquareCheck size={16} /> : <Square size={16} />}
                </button>
                <button
                  className="photo-content"
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
              </div>
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
            <span>{selectedIds.size > 0 ? `已选 ${selectedIds.size} 张 / 共 ${photos.length} 张` : `${photos.length} 张照片`}</span>
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
              ref={paperPreviewRef}
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
                  style={{
                    objectFit: print.fit === 'cover' || print.fit === 'adaptive' ? 'cover' : 'contain',
                    transform: `rotate(${selectedPhoto.adjustments.rotateDeg}deg)`,
                    filter: `brightness(${selectedPhoto.adjustments.brightness})`,
                    clipPath: cropToClipPath(selectedPhoto.adjustments.crop)
                  }}
                />
              </div>
              <div
                className={`watermark ${watermark.position === 'custom' ? 'watermark-custom' : `watermark-${watermark.position}`} ${watermark.backgroundEnabled ? 'with-background' : ''} ${watermark.position === 'custom' ? 'draggable' : ''}`}
                style={{
                  color: watermark.color,
                  opacity: watermark.opacity,
                  fontFamily: watermark.fontFamily,
                  fontSize: `${Math.max(12, watermark.fontSize)}px`,
                  ...(watermark.position === 'custom' && {
                    left: `${watermark.customX ?? 10}%`,
                    top: `${watermark.customY ?? 90}%`,
                    transform: 'translate(-50%, -50%)'
                  })
                }}
                onMouseDown={handleWatermarkMouseDown}
              >
                {renderWatermarkLines(watermark, selectedPhoto).map((line, index) => (
                  <span
                    key={`${line.text}-${index}`}
                    style={
                      line.kind === 'address'
                        ? {
                            color: watermark.addressColor,
                            fontFamily: watermark.addressFontFamily,
                            fontSize: `${Math.max(10, watermark.addressFontSize)}px`
                          }
                        : undefined
                    }
                  >
                    {line.text}
                  </span>
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
          <span className="status-copy">
            <strong>{busyLabel ?? '就绪'}</strong>
            {busyDetail && <small>{busyDetail}</small>}
          </span>
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
          <h2>
            <MapPin size={16} />
            地址样式
          </h2>
          <label>
            地址字体
            <select
              value={selectedAddressFontId}
              onChange={(event) => {
                const font = fonts.find((item) => item.id === event.target.value);
                if (!font) return;
                setWatermark({ ...watermark, addressFontFamily: font.family, addressFontPath: font.path });
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
              地址字号
              <input
                type="number"
                min="10"
                max="72"
                value={watermark.addressFontSize}
                onChange={(event) => setWatermark({ ...watermark, addressFontSize: Number(event.target.value) })}
              />
            </label>
            <label>
              地址颜色
              <input
                type="color"
                value={watermark.addressColor}
                onChange={(event) => setWatermark({ ...watermark, addressColor: event.target.value })}
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
              <option value="custom">自定义（可拖拽）</option>
            </select>
          </label>
          {watermark.position === 'custom' && (
            <div className="hint">
              选择"自定义"后，可在预览区直接拖动水印调整位置。
            </div>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={watermark.backgroundEnabled}
              onChange={(event) => setWatermark({ ...watermark, backgroundEnabled: event.target.checked })}
            />
            水印背景
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
              <option value="bigdatacloud">BigDataCloud · 免 Key 中文</option>
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
                <option value="a3">A3</option>
                <option value="a4">A4</option>
                <option value="a5">A5</option>
                <option value="letter">Letter</option>
                <option value="legal">Legal</option>
                <option value="photo-4r">4R 相纸</option>
                <option value="photo-5r">5R 相纸</option>
                <option value="photo-6r">6R 相纸</option>
                <option value="custom">自定义纸张</option>
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
          {print.paper === 'custom' && (
            <div className="field-grid">
              <label>
                纸宽 mm
                <input
                  type="number"
                  min="20"
                  max="1200"
                  step="0.1"
                  value={print.customPaperWidthMm}
                  onChange={(event) => setPrint({ ...print, customPaperWidthMm: Number(event.target.value) })}
                />
              </label>
              <label>
                纸高 mm
                <input
                  type="number"
                  min="20"
                  max="1200"
                  step="0.1"
                  value={print.customPaperHeightMm}
                  onChange={(event) => setPrint({ ...print, customPaperHeightMm: Number(event.target.value) })}
                />
              </label>
            </div>
          )}
          <label>
            照片尺寸
            <select
              value={print.photoSize}
              onChange={(event) => setPrint({ ...print, photoSize: event.target.value as PrintSettings['photoSize'] })}
            >
              <option value="fit-page">适应可打印区域</option>
              <option value="4r">4R 相纸 · 4 x 6 in</option>
              <option value="5r">5R 相纸 · 5 x 7 in</option>
              <option value="6r">6R 相纸 · 6 x 8 in</option>
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
                <option value="adaptive">自适应 · 完全铺开（可轻微变形）</option>
                <option value="cover">基于相纸铺开 · 不变形（可能裁剪）</option>
                <option value="contain">原始比例 · 完整显示（可能留白）</option>
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
          <div className="metadata-list">
            {buildPhotoMetadataRows(selectedPhoto).map((row) => (
              <div className="metadata-row" key={row.label}>
                <span>{row.label}</span>
                <strong title={row.value}>{row.value}</strong>
              </div>
            ))}
          </div>
          <label>
            拍摄时间
            <input
              type="datetime-local"
              value={selectedPhoto?.capturedAt ? toDateTimeInputValue(selectedPhoto.capturedAt) : ''}
              onChange={(event) =>
                updateSelectedPhoto({
                  capturedAt: event.target.value ? new Date(event.target.value).toISOString() : null,
                  capturedAtSource: 'manual'
                })
              }
              disabled={!selectedPhoto}
            />
          </label>
          <h2>
            <MapPin size={16} />
            地址
          </h2>
          <label>
            城市
            <input
              type="text"
              value={selectedPhoto?.city ?? ''}
              placeholder="手动填写城市"
              onChange={(event) => updateSelectedPhoto({ city: event.target.value })}
              disabled={!selectedPhoto}
            />
          </label>
        </section>

        <section className="settings-section">
          <h2>
            <Scissors size={16} />
            图片调整
          </h2>
          <div className="button-row">
            <button
              className="text-button"
              disabled={!selectedPhoto}
              onClick={() =>
                updateSelectedAdjustments({
                  rotateDeg: (((selectedPhoto?.adjustments.rotateDeg ?? 0) + 270) % 360) as PhotoRecord['adjustments']['rotateDeg']
                })
              }
            >
              <RotateCcw size={16} />
              左转
            </button>
            <button
              className="text-button"
              disabled={!selectedPhoto}
              onClick={() =>
                updateSelectedAdjustments({
                  rotateDeg: (((selectedPhoto?.adjustments.rotateDeg ?? 0) + 90) % 360) as PhotoRecord['adjustments']['rotateDeg']
                })
              }
            >
              <RotateCw size={16} />
              右转
            </button>
          </div>
          <label>
            亮度
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={selectedPhoto?.adjustments.brightness ?? 1}
              onChange={(event) => updateSelectedAdjustments({ brightness: Number(event.target.value) })}
              disabled={!selectedPhoto}
            />
            <span className="hint">{Math.round((selectedPhoto?.adjustments.brightness ?? 1) * 100)}%</span>
          </label>
          <div className="crop-grid">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side}>
                {cropSideLabel(side)}
                <input
                  type="range"
                  min="0"
                  max="45"
                  step="1"
                  value={selectedPhoto?.adjustments.crop[side] ?? 0}
                  onChange={(event) => updateCrop(side, Number(event.target.value))}
                  disabled={!selectedPhoto}
                />
              </label>
            ))}
          </div>
          <button className="text-button" disabled={!selectedPhoto} onClick={resetAdjustments}>
            <RefreshCcw size={16} />
            重置调整
          </button>
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

function renderWatermarkLines(
  watermark: WatermarkSettings,
  photo: PhotoRecord | null
): Array<{ text: string; kind: 'default' | 'address' }> {
  if (!photo) return [];
  return watermark.template
    .split('\n')
    .map((templateLine) => ({
      text: renderWatermarkText(templateLine, photo),
      kind: /\{city\}|\{address\}/.test(templateLine) ? ('address' as const) : ('default' as const)
    }))
    .filter((line) => line.text.trim());
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

function toDateTimeInputValue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const date = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${date}T${hours}:${minutes}`;
}

function cropToClipPath(crop: PhotoRecord['adjustments']['crop']): string {
  return `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)`;
}

function cropSideLabel(side: keyof PhotoRecord['adjustments']['crop']): string {
  if (side === 'top') return '上裁剪';
  if (side === 'right') return '右裁剪';
  if (side === 'bottom') return '下裁剪';
  return '左裁剪';
}

function getPaperSize(print: PrintSettings): { width: number; height: number } {
  const base = getPaperSizeBase(print);
  return print.orientation === 'portrait' ? base : { width: base.height, height: base.width };
}

function getPhotoAreaStyle(print: PrintSettings, photo: PhotoRecord | null): React.CSSProperties {
  if (print.photoSize === 'fit-page') {
    return { width: '100%', height: '100%' };
  }

  const paperMm = getPaperSizeMm(print);
  const size = getPhotoSizeMm(print);
  const isLandscape = Boolean(photo?.width && photo?.height && photo.width > photo.height);
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
  const base = getPaperSizeBaseMm(print);
  return print.orientation === 'portrait' ? base : { width: base.height, height: base.width };
}

function getPaperSizeBase(print: PrintSettings): { width: number; height: number } {
  const mm = getPaperSizeBaseMm(print);
  return { width: mm.width * 2.834645669, height: mm.height * 2.834645669 };
}

function getPaperSizeBaseMm(print: PrintSettings): { width: number; height: number } {
  if (print.paper === 'a3') return { width: 297, height: 420 };
  if (print.paper === 'a5') return { width: 148, height: 210 };
  if (print.paper === 'letter') return { width: 215.9, height: 279.4 };
  if (print.paper === 'legal') return { width: 215.9, height: 355.6 };
  if (print.paper === 'photo-4r') return { width: 101.6, height: 152.4 };
  if (print.paper === 'photo-5r') return { width: 127, height: 177.8 };
  if (print.paper === 'photo-6r') return { width: 152.4, height: 203.2 };
  if (print.paper === 'custom') {
    return {
      width: Math.max(20, print.customPaperWidthMm || 210),
      height: Math.max(20, print.customPaperHeightMm || 297)
    };
  }
  return { width: 210, height: 297 };
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

function buildPhotoMetadataRows(photo: PhotoRecord | null): Array<{ label: string; value: string }> {
  if (!photo) {
    return [{ label: '读取状态', value: '未选择照片' }];
  }

  return [
    { label: '读取状态', value: formatPhotoStatus(photo) },
    { label: '文件格式', value: photo.extension ? photo.extension.toUpperCase() : '未知' },
    { label: '文件大小', value: formatFileSize(photo.fileSize) },
    { label: '图片尺寸', value: formatImageSize(photo.width, photo.height) },
    { label: '拍摄时间来源', value: formatCapturedAtSource(photo.capturedAtSource) },
    { label: 'GPS 坐标', value: formatGps(photo.gps) },
    { label: 'GPS 来源', value: photo.gpsSource ?? '未读取到' },
    { label: '地址来源', value: photo.locationSource ?? '未读取到' },
    { label: '文件创建时间', value: photo.createdAt ? formatDate(photo.createdAt) : '未读取到' },
    { label: '文件修改时间', value: photo.modifiedAt ? formatDate(photo.modifiedAt) : '未读取到' },
    { label: '文件路径', value: photo.path },
    ...(photo.error ? [{ label: '读取提示', value: photo.error }] : [])
  ];
}

function formatPhotoStatus(photo: PhotoRecord): string {
  if (photo.status === 'ready') return '已读取元数据和预览';
  if (photo.status === 'preview-error') return '元数据已读取，预览生成失败';
  return '元数据读取失败';
}

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes < 0) return '未读取到';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatImageSize(width: number | null, height: number | null): string {
  if (!width || !height) return '未读取到';
  return `${width} x ${height} px`;
}

function formatCapturedAtSource(source: string): string {
  if (source === 'DateTimeOriginal') return 'EXIF DateTimeOriginal';
  if (source === 'CreateDate') return 'EXIF CreateDate';
  if (source === 'ModifyDate') return 'EXIF ModifyDate';
  if (source === 'FileCreateDate') return 'EXIF FileCreateDate';
  if (source === 'file-birthtime') return '文件创建时间兜底';
  if (source === 'manual') return '手动修改';
  return source || '未知';
}

function formatGps(gps: PhotoRecord['gps']): string {
  if (!gps) return '未读取到';
  return `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`;
}

function formatImportProgressLabel(event: ImportProgressEvent): string {
  const suffix = event.total > 0 ? ` ${event.index}/${event.total}` : '';
  if (event.stage === 'dialog') return event.message ?? '等待选择照片';
  if (event.stage === 'scanning') return event.message ?? '正在扫描照片文件夹';
  if (event.stage === 'selected') return event.message ?? '已选择照片';
  if (event.stage === 'metadata') return `正在读取照片信息${suffix}`;
  if (event.stage === 'preview') return `正在生成预览图${suffix}`;
  if (event.stage === 'warning') return `照片处理警告${suffix}`;
  if (event.stage === 'error') return `照片处理失败${suffix}`;
  if (event.stage === 'done') return event.message ?? `照片导入完成${suffix}`;
  return event.message ?? '正在导入照片';
}

function formatImportProgressDetail(event: ImportProgressEvent): string | null {
  const parts = [event.fileName, event.message].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  return event.path ?? null;
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
