// @ts-nocheck
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.message?.includes('503') ? 503 : (err?.status || 0);
      if ((status === 503 || status === 429) && i < maxRetries - 1) {
        const wait = Math.pow(2, i) * 1000;
        console.log(`API busy, retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}


import { useState, useEffect, useRef } from 'react';
import {
  FileText, Upload, Download, Sparkles, RefreshCw,
  Eye, Table as TableIcon,
  ChevronRight, ChevronLeft, Search, Plus, Scan,
  Pill, Zap, Filter
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import * as XLSX from 'xlsx';
import { ERP_COLUMNS } from './utils/constants';
import { ErpRow, InvoiceHeader, RawTextLine, normalizeToErpRows, performGeminiOcrOnCanvas, performTesseractOcrOnCanvas, parseTesseractTextToStructuredData, performGeminiVerbatimOcrOnCanvas } from './utils/ocr';
import { extractAllPagesData, loadPdfDocument, renderPdfPageToCanvas } from './utils/pdfExtraction';
import UploadMenu from './components/UploadMenu';
import MetadataPanel from './components/MetadataPanel';
import StudioTable from './components/StudioTable';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const INITIAL_SAMPLE_DATA: ErpRow[] = [
  {
    "SUPPLIER": "HEALING PHARMACY CHD", "BILL NO.": "MK010343", "DATE": "29-07-2026", "COMPANY": "LARENO", "CODE": "", "BARCODE": "",
    "ITEM NAME": "DAPAHENZ M 10/500", "PACK": "10'S", "BATCH": "EMV242373C", "EXPIRY": "10/26", "QTY": "10", "F.QTY": "0", "HALFP": "", "FTRATE": "",
    "SRATE": "120.71", "MRP": "158.44", "DIS": "0", "EXCISE": "", "VAT": "", "ADNLVAT": "", "AMOUNT": "120.71", "LOCALCENT": "", "SCM1": "", "SCM2": "",
    "SCMPER": "", "HSNCODE": "30049099", "CGST": "6.00", "SGST": "6.00", "IGST": "0", "PSRLNO": "1", "TCSPER": "", "TCSAMT": "", "ALTERCODE": "", "PONUMBER": ""
  },
  {
    "SUPPLIER": "HEALING PHARMACY CHD", "BILL NO.": "MK010343", "DATE": "29-07-2026", "COMPANY": "LARENO", "CODE": "", "BARCODE": "",
    "ITEM NAME": "DAPAHENZ M 10/500", "PACK": "10'S", "BATCH": "EMV253045A", "EXPIRY": "11/27", "QTY": "15", "F.QTY": "0", "HALFP": "", "FTRATE": "",
    "SRATE": "132.14", "MRP": "173.43", "DIS": "0", "EXCISE": "", "VAT": "", "ADNLVAT": "", "AMOUNT": "264.28", "LOCALCENT": "", "SCM1": "", "SCM2": "",
    "SCMPER": "", "HSNCODE": "30049099", "CGST": "6.00", "SGST": "6.00", "IGST": "0", "PSRLNO": "2", "TCSPER": "", "TCSAMT": "", "ALTERCODE": "", "PONUMBER": ""
  },
  {
    "SUPPLIER": "HEALING PHARMACY CHD", "BILL NO.": "MK010343", "DATE": "29-07-2026", "COMPANY": "DR RED", "CODE": "", "BARCODE": "",
    "ITEM NAME": "GLIMY M1 FORTE", "PACK": "1*10", "BATCH": "E2600061", "EXPIRY": "10/27", "QTY": "3", "F.QTY": "0", "HALFP": "", "FTRATE": "",
    "SRATE": "91.96", "MRP": "120.70", "DIS": "0", "EXCISE": "", "VAT": "", "ADNLVAT": "", "AMOUNT": "275.88", "LOCALCENT": "", "SCM1": "", "SCM2": "",
    "SCMPER": "", "HSNCODE": "30049062", "CGST": "6.00", "SGST": "6.00", "IGST": "0", "PSRLNO": "3", "TCSPER": "", "TCSAMT": "", "ALTERCODE": "", "PONUMBER": ""
  },
  {
    "SUPPLIER": "HEALING PHARMACY CHD", "BILL NO.": "MK010343", "DATE": "29-07-2026", "COMPANY": "DR RED", "CODE": "", "BARCODE": "",
    "ITEM NAME": "XYZAL5 TAB", "PACK": "1*10", "BATCH": "TE2501289", "EXPIRY": "4/27", "QTY": "2", "F.QTY": "0", "HALFP": "", "FTRATE": "", "SRATE": "155.90", "MRP": "204.60", "DIS": "0", "EXCISE": "", "VAT": "", "ADNLVAT": "", "AMOUNT": "311.80", "LOCALCENT": "", "SCM1": "", "SCM2": "",
    "SCMPER": "", "HSNCODE": "30049099", "CGST": "6.00", "SGST": "6.00", "IGST": "0", "PSRLNO": "4", "TCSPER": "", "TCSAMT": "", "ALTERCODE": "", "PONUMBER": ""
  }
];

const AI_OCR_CONCURRENCY = 6; // Back to original for speed

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await task(values[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function getRetryDelayMilliseconds(message: string): number {
  const match = message.match(/(?:retry in|retryDelay[^0-9]*)(\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : 60_000;
}

export default function App() {
  const [tableData, setTableData] = useState<ErpRow[]>(INITIAL_SAMPLE_DATA);
  const [docHeaderInfo, setDocHeaderInfo] = useState<InvoiceHeader>({
    supplier: 'HEALING PHARMACY CHD',
    billNo: 'MK010343',
    date: '29-07-2026'
  });
  const [activeTab, setActiveTab] = useState<'studio' | 'raw'>('studio');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Ready for processing');
  const [isDragging, setIsDragging] = useState(false);
  const [autoFillHeaderInfo, setAutoFillHeaderInfo] = useState(true);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isScannedPdf, setIsScannedPdf] = useState(false);
  const [rawTextLines, setRawTextLines] = useState<RawTextLine[]>([]);
  const [rawSearchTerm, setRawSearchTerm] = useState('');
  const [tesseractProgress, setTesseractProgress] = useState({ status: '', progress: 0 });
  const [ocrUsageCount, setOcrUsageCount] = useState(0);
  const [selectedUploadType, setSelectedUploadType] = useState<'excel' | 'text' | null>(null);
  const [showMasterMenu, setShowMasterMenu] = useState(false);
  const [activeView, setActiveView] = useState<'extractor' | 'csv'>('extractor');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string>('');
  const [isCsvProcessing, setIsCsvProcessing] = useState(false);
  const [csvStatus, setCsvStatus] = useState('');
  const [aiRetryUntil, setAiRetryUntil] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const ocrCacheKeyRef = useRef<string | null>(null);
  const aiRateLimited = aiRetryUntil > Date.now();

  const saveOcrCache = (rows: ErpRow[], header: InvoiceHeader) => {
    if (!ocrCacheKeyRef.current) return;
    try {
      localStorage.setItem(ocrCacheKeyRef.current, JSON.stringify({ rows, header }));
    } catch (error) {
      console.warn('Could not cache OCR result:', error);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('invoice_metadata');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.supplier || parsed.billNo || parsed.date) {
          setDocHeaderInfo(parsed);
        }
      } catch (e) {
        console.error('Failed to load saved metadata:', e);
      }
    }
  }, []);

  useEffect(() => {
    const today = new Date().toDateString();
    const stored = localStorage.getItem('gemini_ocr_usage');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.date === today) {
        setOcrUsageCount(parsed.count || 0);
      } else {
        localStorage.setItem('gemini_ocr_usage', JSON.stringify({ date: today, count: 0 }));
      }
    } else {
      localStorage.setItem('gemini_ocr_usage', JSON.stringify({ date: new Date().toDateString(), count: 0 }));
    }
  }, []);

  const incrementOcrUsage = (count = 1) => {
    setOcrUsageCount(prev => {
      const newCount = prev + count;
      localStorage.setItem('gemini_ocr_usage', JSON.stringify({ date: new Date().toDateString(), count: newCount }));
      return newCount;
    });
  };

  const processFile = async (file: File) => {
    if (!file) return;

    setIsProcessing(true);
    setStatusMsg(`Loading "${file.name}"...`);
    setTableData([]);
    setDocHeaderInfo({ supplier: '', billNo: '', date: '' });
    setIsScannedPdf(false);
    ocrCacheKeyRef.current = `invoice_ocr_cache:${file.name}:${file.size}:${file.lastModified}`;

    if (file.type.startsWith('image/')) {
      setIsScannedPdf(true);
      setPdfDoc(null);
      setTotalPages(1);
      setCurrentPage(1);

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          if (canvasRef.current) {
            const canvas = canvasRef.current;
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx!.drawImage(img, 0, 0);
          }
          setStatusMsg("Image loaded. Use Tesseract OCR (free) or AI Vision OCR to extract data.");
          setIsProcessing(false);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
      return;
    }

    try {
      const loadedPdf = await loadPdfDocument(file);
      setPdfDoc(loadedPdf);
      setTotalPages(loadedPdf.numPages);
      setCurrentPage(1);

      try {
        const cached = localStorage.getItem(ocrCacheKeyRef.current);
        if (cached) {
          const { rows, header } = JSON.parse(cached);
          if (Array.isArray(rows) && header) {
            setTableData(rows);
            setDocHeaderInfo(header);
            setStatusMsg(`Loaded ${rows.length} cached OCR rows instantly.`);
            return;
          }
        }
      } catch (cacheError) {
        console.warn('Could not read OCR cache:', cacheError);
      }

      let result;
      try {
        result = await extractAllPagesData(loadedPdf, docHeaderInfo);
      } catch (extractionError) {
        console.warn('[PDF] Fast extraction failed:', extractionError);
        setIsScannedPdf(true);
        setStatusMsg('Fast PDF extraction failed. Use Local OCR first, then AI verification only if needed.');
        return;
      }
      setTableData(result.rows);
      setDocHeaderInfo({ supplier: result.supplier, billNo: result.billNo, date: result.date });

      if (result.needsAiVerification) {
        setIsScannedPdf(true);
        setStatusMsg('Fast extraction needs verification. Try Local OCR first; use AI verification only for unclear pages.');
      } else {
        setIsScannedPdf(false);
        saveOcrCache(result.rows, {
          supplier: result.supplier,
          billNo: result.billNo,
          date: result.date
        });
        setStatusMsg(`Extracted ${result.rows.length} rows from all ${loadedPdf.numPages} pages!`);
      }
    } catch (err) {
      console.error('[PDF] Error:', err);
      setStatusMsg("Error reading PDF file: " + (err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
      e.target.value = '';
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setStatusMsg(`Reading "${file.name}"...`);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!jsonData || jsonData.length === 0) {
          setStatusMsg("Excel file is empty.");
          setIsProcessing(false);
          return;
        }

        const firstRow = jsonData[0].map((h: any) => String(h).trim().toUpperCase());
        const hasHeaders = firstRow.some(h =>
          ["ITEM", "PRODUCT", "DESCRIPTION", "QTY", "QUANTITY", "BATCH", "EXPIRY", "PACK", "MRP", "RATE", "AMOUNT", "HSN", "CGST", "SGST", "IGST"].includes(h)
        );

        let rows: ErpRow[];
        if (hasHeaders) {
          rows = jsonData.slice(1).map((row: any[]) => {
            const rowObj: ErpRow = {};
            ERP_COLUMNS.forEach(col => rowObj[col] = "");
            firstRow.forEach((header, idx) => {
              if (header === "ITEM NAME" || header === "ITEM" || header === "PRODUCT") rowObj["ITEM NAME"] = String(row[idx] || "");
              else if (header === "QTY" || header === "QUANTITY") rowObj["QTY"] = String(row[idx] || "");
              else if (header === "BATCH") rowObj["BATCH"] = String(row[idx] || "");
              else if (header === "EXPIRY") rowObj["EXPIRY"] = String(row[idx] || "");
              else if (header === "PACK") rowObj["PACK"] = String(row[idx] || "");
              else if (header === "MRP") rowObj["MRP"] = String(row[idx] || "");
              else if (header === "RATE" || header === "SRATE") rowObj["SRATE"] = String(row[idx] || "");
              else if (header === "AMOUNT") rowObj["AMOUNT"] = String(row[idx] || "");
              else if (header === "HSN" || header === "HSNCODE") rowObj["HSNCODE"] = String(row[idx] || "");
              else if (header === "CGST") rowObj["CGST"] = String(row[idx] || "");
              else if (header === "SGST") rowObj["SGST"] = String(row[idx] || "");
              else if (header === "IGST") rowObj["IGST"] = String(row[idx] || "");
              else if (header === "COMPANY" || header === "MFG") rowObj["COMPANY"] = String(row[idx] || "");
              else if (header === "SUPPLIER") rowObj["SUPPLIER"] = String(row[idx] || "");
              else if (header === "BILL NO." || header === "BILL NO") rowObj["BILL NO."] = String(row[idx] || "");
              else if (header === "DATE") rowObj["DATE"] = String(row[idx] || "");
            });
            rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
            return rowObj;
          });
        } else {
          rows = jsonData.map((row: any[]) => {
            const rowObj: ErpRow = {};
            ERP_COLUMNS.forEach(col => rowObj[col] = "");
            row.forEach((cell: any, idx: number) => {
              if (idx < ERP_COLUMNS.length) rowObj[ERP_COLUMNS[idx]] = String(cell || "");
            });
            rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
            return rowObj;
          });
        }

        if (rows.length > 0) {
          setTableData(rows);
          setStatusMsg(`Loaded ${rows.length} rows from Excel!`);
        } else {
          setStatusMsg("No valid data rows found in Excel file.");
        }
      } catch (err) {
        console.error("Excel Error:", err);
        setStatusMsg("Error reading Excel file: " + (err as Error).message);
      } finally {
        setIsProcessing(false);
        e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleTextUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setStatusMsg(`Reading text file "${file.name}"...`);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length === 0) {
          setStatusMsg("Text file is empty.");
          setIsProcessing(false);
          return;
        }

        const firstLine = lines[0];
        let rows: ErpRow[] = [];

        if (firstLine.includes('|')) {
          rows = lines.map(line => {
            const fields = line.split('|').map(f => f.trim()).slice(1);
            const rowObj: ErpRow = {};
            ERP_COLUMNS.forEach(col => rowObj[col] = "");
            fields.forEach((field, idx) => {
              if (idx < ERP_COLUMNS.length) rowObj[ERP_COLUMNS[idx]] = field;
            });
            rowObj["_RAW_TEXT"] = fields.join(' | ');
            return rowObj;
          });
        } else if (firstLine.includes(',') || firstLine.includes('\t')) {
          const delimiter = firstLine.includes('\t') ? '\t' : ',';
          const jsonData = lines.map(l => l.split(delimiter));
          const firstRow = jsonData[0].map((h: any) => String(h).trim().toUpperCase());
          const hasHeaders = firstRow.some(h =>
            ["ITEM", "PRODUCT", "QTY", "BATCH", "EXPIRY", "PACK", "MRP", "RATE", "AMOUNT"].includes(h)
          );

          if (hasHeaders) {
            rows = jsonData.slice(1).map((row: any[]) => {
              const rowObj: ErpRow = {};
              ERP_COLUMNS.forEach(col => rowObj[col] = "");
              firstRow.forEach((header, idx) => {
                if (header === "ITEM NAME" || header === "ITEM" || header === "PRODUCT") rowObj["ITEM NAME"] = String(row[idx] || "");
                else if (header === "QTY" || header === "QUANTITY") rowObj["QTY"] = String(row[idx] || "");
                else if (header === "BATCH") rowObj["BATCH"] = String(row[idx] || "");
                else if (header === "EXPIRY") rowObj["EXPIRY"] = String(row[idx] || "");
                else if (header === "PACK") rowObj["PACK"] = String(row[idx] || "");
                else if (header === "MRP") rowObj["MRP"] = String(row[idx] || "");
                else if (header === "RATE" || header === "SRATE") rowObj["SRATE"] = String(row[idx] || "");
                else if (header === "AMOUNT") rowObj["AMOUNT"] = String(row[idx] || "");
              });
              rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
              return rowObj;
            });
          } else {
            rows = jsonData.map((row: any[]) => {
              const rowObj: ErpRow = {};
              ERP_COLUMNS.forEach(col => rowObj[col] = "");
              row.forEach((cell: any, idx: number) => {
                if (idx < ERP_COLUMNS.length) rowObj[ERP_COLUMNS[idx]] = String(cell || "");
              });
              rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
              return rowObj;
            });
          }
        } else {
          const rowObj: ErpRow = {};
          ERP_COLUMNS.forEach(col => rowObj[col] = "");
          rowObj["_RAW_TEXT"] = firstLine;
          rowObj["ITEM NAME"] = firstLine;
          rows = [rowObj];
        }

        if (rows.length > 0) {
          setTableData(rows);
          setStatusMsg(`Loaded ${rows.length} rows from text file!`);
        } else {
          setStatusMsg("No valid data rows found in text file.");
        }
      } catch (err) {
        console.error("Text File Error:", err);
        setStatusMsg("Error reading text file: " + (err as Error).message);
      } finally {
        setIsProcessing(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleRunAiOcr = async (
    targetPages: 'current' | 'all' = 'current',
    documentOverride?: any,
    headerOverride?: InvoiceHeader
  ) => {
    const documentToProcess = documentOverride || pdfDoc;
    if (!documentToProcess) {
      setStatusMsg("Please upload a PDF invoice first.");
      return;
    }
    if (aiRateLimited) {
      setStatusMsg('Gemini is temporarily rate-limited. Use Local OCR or wait before retrying AI verification.');
      return;
    }

    setIsProcessing(true);
    setStatusMsg("Initializing Gemini AI Vision OCR...");

    try {
      let combinedItems: any[] = [];
      let finalHeader = { ...(headerOverride || docHeaderInfo) };

      const pagesToProcess = targetPages === 'all'
        ? Array.from({ length: documentToProcess.numPages }, (_, i) => i + 1)
        : [currentPage];

      const ocrResults = await mapWithConcurrency(pagesToProcess, AI_OCR_CONCURRENCY, async (pageNum) => {
        setStatusMsg(`Rendering Page ${pageNum} for AI Vision OCR...`);
        const page = await documentToProcess.getPage(pageNum);
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d')!;
        const viewport = page.getViewport({ scale: 1.0 });
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;

        const cropTop = Math.floor(tempCanvas.height * 0.10);
        const cropBottom = Math.ceil(tempCanvas.height * 0.85);
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = tempCanvas.width;
        croppedCanvas.height = cropBottom - cropTop;
        const cropCtx = croppedCanvas.getContext('2d')!;
        cropCtx.drawImage(tempCanvas, 0, cropTop, tempCanvas.width, cropBottom - cropTop, 0, 0, croppedCanvas.width, croppedCanvas.height);

        setStatusMsg(`Analyzing Page ${pageNum} with Gemini AI Vision...`);
        const ocrData = await withRetry(() => performGeminiOcrOnCanvas(croppedCanvas));
        incrementOcrUsage(1);
        return ocrData;
      });
      for (const ocrData of ocrResults) {
        if (ocrData) {
          if (ocrData.supplier && !finalHeader.supplier) finalHeader.supplier = ocrData.supplier;
          if (ocrData.billNo && !finalHeader.billNo) finalHeader.billNo = ocrData.billNo;
          if (ocrData.date && !finalHeader.date) finalHeader.date = ocrData.date;

          if (Array.isArray(ocrData.items)) {
            combinedItems = [...combinedItems, ...ocrData.items];
          }
        }
      }

      const normalizedRows = normalizeToErpRows(
        combinedItems,
        finalHeader,
        autoFillHeaderInfo,
        targetPages === 'all' ? 0 : tableData.length
      );

      if (normalizedRows.length > 0) {
        setTableData(targetPages === 'all' ? normalizedRows : [...tableData, ...normalizedRows]);
        setDocHeaderInfo(finalHeader);
        if (targetPages === 'all') saveOcrCache(normalizedRows, finalHeader);
        setIsScannedPdf(false);
        setStatusMsg(`Extracted ${normalizedRows.length} items using Gemini AI Vision OCR!`);
      } else {
        console.warn("No items extracted. Extracted data:", combinedItems);
        console.warn("Final header:", finalHeader);
        setStatusMsg(`AI OCR returned data but no items detected. Try Local OCR or improve image clarity.`);
      }
    } catch (err) {
      console.error("AI OCR Error:", err);
      const message = err instanceof Error ? err.message : String(err);
      
      if (message.includes('429')) {
        const delay = getRetryDelayMilliseconds(message);
        setAiRetryUntil(Date.now() + delay);
        window.setTimeout(() => setAiRetryUntil(0), delay);
        setStatusMsg(`Gemini quota reached. AI is paused; use Local OCR now, then retry AI after ${Math.ceil(delay / 1000)} seconds.`);
      } else if (message.includes('Falling back to Local OCR')) {
        // Auto-fallback to Local OCR (Tesseract)
        console.log("AI failed, auto-fallback to Local OCR...");
        setStatusMsg("AI unavailable. Attempting Local OCR (Tesseract)...");
        try {
          const page = await pdfDoc.getPage(currentPage);
          const tempCanvas = document.createElement('canvas');
          const ctx = tempCanvas.getContext('2d')!;
          const viewport = page.getViewport({ scale: 1.0 });
          tempCanvas.width = viewport.width;
          tempCanvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
          
          const text = await performTesseractOcrOnCanvas(tempCanvas, (msg) => setStatusMsg(`Local OCR: ${msg}`));
          const lines = text.split('\n').map(t => ({ text: t.trim(), y: 0 })).filter(l => l.text);
          const parsedRows = parseTesseractTextToStructuredData(lines);
          setTableData([...tableData, ...parsedRows]);
          setStatusMsg(`Local OCR extracted ${parsedRows.length} rows.`);
        } catch (localErr) {
          // Last resort: Extract raw text lines for user
          console.error("Local OCR also failed, extracting raw text...");
          setStatusMsg("OCR unavailable. Extracting raw text for manual review...");
          try {
            const page = await pdfDoc.getPage(currentPage);
            const text = await page.getTextContent();
            const rawText = text.items.map((item: any) => item.str).join(' ');
            setStatusMsg(`📝 Raw text extracted: "${rawText.substring(0, 100)}...". Please review and edit manually.`);
          } catch (_) {
            setStatusMsg("⚠️ All OCR methods failed. Please try uploading a clearer image or PDF.");
          }
        }
      } else {
        setStatusMsg("AI OCR Error: " + message);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunTesseractOcr = async (targetPages: 'current' | 'all' = 'current') => {
    if (!pdfDoc) {
      setStatusMsg("Please upload a PDF invoice first.");
      return;
    }

    setIsProcessing(true);
    setTesseractProgress({ status: 'Loading Tesseract OCR engine...', progress: 0 });

    try {
      let combinedItems: any[] = [];
      let finalHeader = { ...docHeaderInfo };

      const pagesToProcess = targetPages === 'all'
        ? Array.from({ length: totalPages }, (_, i) => i + 1)
        : [currentPage];

      for (const pageNum of pagesToProcess) {
        setTesseractProgress({ status: `Rendering Page ${pageNum}...`, progress: 0 });

        const page = await pdfDoc.getPage(pageNum);
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d')!;
        const viewport = page.getViewport({ scale: 1.5 });
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;

        setTesseractProgress({ status: `OCR Page ${pageNum} - Initializing...`, progress: 0 });
        const rawText = await performTesseractOcrOnCanvas(tempCanvas, setTesseractProgress);

        if (rawText) {
          const parsed = parseTesseractTextToStructuredData(rawText, docHeaderInfo, autoFillHeaderInfo);

          if (parsed.header.supplier && !finalHeader.supplier) finalHeader.supplier = parsed.header.supplier;
          if (parsed.header.billNo && !finalHeader.billNo) finalHeader.billNo = parsed.header.billNo;
          if (parsed.header.date && !finalHeader.date) finalHeader.date = parsed.header.date;

          if (Array.isArray(parsed.items)) {
            combinedItems = [...combinedItems, ...parsed.items];
          }
        }
      }

      const normalizedRows = normalizeToErpRows(
        combinedItems,
        finalHeader,
        autoFillHeaderInfo,
        targetPages === 'all' ? 0 : tableData.length
      );

      if (normalizedRows.length > 0) {
        setTableData(targetPages === 'all' ? normalizedRows : [...tableData, ...normalizedRows]);
        setDocHeaderInfo(finalHeader);
        setIsScannedPdf(false);
        setStatusMsg(`Extracted ${normalizedRows.length} items using Tesseract OCR!`);
      } else {
        setStatusMsg("Tesseract OCR complete, but no items detected. Try AI Vision OCR for better accuracy.");
      }
    } catch (err) {
      console.error("Tesseract OCR Error:", err);
      setStatusMsg("Tesseract OCR Error: " + (err as Error).message);
    } finally {
      setIsProcessing(false);
      setTesseractProgress({ status: '', progress: 0 });
    }
  };

  useEffect(() => {
    if (pdfDoc && canvasRef.current) {
      renderPdfPageToCanvas(pdfDoc, currentPage, canvasRef.current, 15, 85).catch(err => console.error("Canvas render error:", err));
    }
  }, [pdfDoc, currentPage]);

  const handleExportExcel = () => {
    localStorage.setItem('invoice_metadata', JSON.stringify(docHeaderInfo));

    const exportData = tableData.map(row => {
      const updatedRow = { ...row };
      if (!updatedRow["SUPPLIER"]) updatedRow["SUPPLIER"] = docHeaderInfo.supplier;
      if (!updatedRow["BILL NO."]) updatedRow["BILL NO."] = docHeaderInfo.billNo;
      if (!updatedRow["DATE"]) updatedRow["DATE"] = docHeaderInfo.date;
      return updatedRow;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData, { header: ERP_COLUMNS });
    const colWidths = ERP_COLUMNS.map(col => ({
      wch: Math.max(col.length + 2, col === 'ITEM NAME' ? 36 : 12)
    }));
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Pharma ERP Clean");

    const headerSheet = XLSX.utils.json_to_sheet([
      { Field: "Supplier Name", Value: docHeaderInfo.supplier || "" },
      { Field: "Bill No.", Value: docHeaderInfo.billNo || "" },
      { Field: "Bill Date", Value: docHeaderInfo.date || "" }
    ], { header: ["Field", "Value"] });
    headerSheet['!cols'] = [{ wch: 18 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(workbook, headerSheet, "Invoice Metadata");

    const fileName = `Clean_Invoice_${docHeaderInfo.billNo || 'Pharma'}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    setStatusMsg(`Saved & exported ${fileName} with Invoice Metadata!`);
  };

const handleConvertPdfToCsv = async () => {
  if (!csvFile) {
    setCsvStatus('Please select a PDF file first.');
    return;
  }
  setIsCsvProcessing(true);
  setCsvContent('');
  setCsvStatus('Initializing...');

  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Missing VITE_GEMINI_API_KEY in .env');

    setCsvStatus('Loading PDF...');
    const arrayBuffer = await csvFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allRawText: string[] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      setCsvStatus(`Processing page ${p} of ${pdf.numPages}...`);
      const page = await pdf.getPage(p);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const viewport = page.getViewport({ scale: 1.25 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;

      setCsvStatus(`Running AI OCR on page ${p} of ${pdf.numPages}...`);
      const rawText = await withRetry(() => 
        performGeminiVerbatimOcrOnCanvas(canvas, (msg) => 
       {   
           setCsvStatus(`Page ${p}: ${msg}`);
      }));

      if (rawText) {
        allRawText.push(rawText);
      }
    }

    if (allRawText.length === 0) {
      setCsvStatus('No text extracted from PDF.');
      setIsCsvProcessing(false);
      return;
    }

    setCsvStatus('Building CSV...');
    const Q = String.fromCharCode(34);
    const csvRows: string[] = [];

    for (const pageText of allRawText) {
      const lines = pageText.split('\n');
      for (const line of lines) {
        const escaped = line.replace(new RegExp(Q, 'g'), Q + Q);
        csvRows.push(Q + escaped + Q);
      }
      csvRows.push(Q + '--- PAGE BREAK ---' + Q);
    }

    const csv = csvRows.join('\n');
    setCsvContent(csv);
    setCsvStatus(`Done. Extracted ${allRawText.length} page(s) with all text.`);
  } catch (err) {
    console.error('PDF to CSV Error:', err);
    setCsvStatus('Error: ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    setIsCsvProcessing(false);
  }
};
  
  
  const handleDownloadCsv = () => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `converted_${csvFile?.name.replace('.pdf', '') || 'document'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleAddRow = () => {
    const emptyRow: ErpRow = {};
    ERP_COLUMNS.forEach(c => emptyRow[c] = "");
    if (autoFillHeaderInfo) {
      emptyRow["SUPPLIER"] = docHeaderInfo.supplier;
      emptyRow["BILL NO."] = docHeaderInfo.billNo;
      emptyRow["DATE"] = docHeaderInfo.date;
      emptyRow["PSRLNO"] = String(tableData.length + 1);
    }
    setTableData([...tableData, emptyRow]);
  };

  const handleDeleteRow = (index: number) => {
    setTableData(tableData.filter((_, i) => i !== index));
  };

  const handleCellEdit = (rowIndex: number, colKey: string, value: string) => {
    const updated = [...tableData];
    updated[rowIndex] = { ...updated[rowIndex], [colKey]: value };
    setTableData(updated);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg text-white font-bold shadow-lg shadow-indigo-500/30">
            <Pill className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              Pharma Invoice Extractor Pro
            </h1>
            <p className="text-xs text-slate-400">Isolated Product Title & 34-Col Pharma ERP Auto-Clean Engine</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => handleRunAiOcr('current')}
            disabled={isProcessing || aiRateLimited || !pdfDoc}
            className="flex items-center space-x-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-3.5 py-2 rounded-lg text-sm font-semibold transition shadow-md shadow-purple-600/30 disabled:opacity-50"
            title="Verify only the current page with AI"
          >
            <Zap className="w-4 h-4 text-yellow-300" />
            <span>AI Verify Current Page</span>
          </button>

                    <button
            onClick={() => window.location.reload()}
            className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition shadow-sm"
            title="Refresh page"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>

          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMasterMenu(!showMasterMenu); }}
              className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition shadow-sm shadow-emerald-600/20"
            >
              <Sparkles className="w-4 h-4 text-yellow-300" />
              <span>Master</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showMasterMenu && (
              <UploadMenu
                show={showMasterMenu}
                selectedType={selectedUploadType}
                onSelectPdf={() => { fileInputRef.current?.click(); setShowMasterMenu(false); }}
                onSelectExcel={() => { setSelectedUploadType('excel'); excelInputRef.current?.click(); setShowMasterMenu(false); }}
                onSelectText={() => { setSelectedUploadType('text'); textInputRef.current?.click(); setShowMasterMenu(false); }}
                onSelectPdfToCsv={() => { setActiveView('csv'); setShowMasterMenu(false); }}
              />
            )}
          </div>


          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="application/pdf,image/*"
            className="hidden"
          />
          <input
            type="file"
            ref={excelInputRef}
            onChange={handleExcelUpload}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />
          <input
            type="file"
            ref={textInputRef}
            onChange={handleTextUpload}
            accept=".txt,.text"
            className="hidden"
          />

          <button
            onClick={handleExportExcel}
            className="flex items-center space-x-2 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition shadow-sm shadow-amber-600/20"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel (.xlsx)</span>
          </button>

          <button
            onClick={() => setActiveView(activeView === 'csv' ? 'extractor' : 'csv')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-semibold transition shadow-sm ${
              activeView === 'csv'
                ? 'bg-amber-600 text-white shadow-amber-600/30'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
            }`}
          >
            <TableIcon className="w-4 h-4" />
            <span>{activeView === 'csv' ? 'Back to Extractor' : 'PDF → CSV'}</span>
          </button>
        </div>
      </header>

      <div className="bg-slate-800/60 border-b border-slate-700/50 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1.5 text-slate-300 bg-slate-900/60 px-3 py-1 rounded-md border border-slate-700">
            <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin text-indigo-400' : 'text-slate-400'}`} />
            <span>{statusMsg}</span>
          </span>
          <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 px-2.5 py-1 rounded-md font-medium">
            {tableData.length} Product Rows
          </span>
          <span className="bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 px-2.5 py-1 rounded-md font-medium">
            OCR Today: {ocrUsageCount} / ~1,500 pages
          </span>
        </div>

        <div className="flex items-center bg-slate-900/80 p-1 rounded-lg border border-slate-700 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('studio')}
            className={`flex items-center space-x-1.5 px-2 sm:px-3 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === 'studio' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>34-Col ERP Data Studio</span>
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === 'raw' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Raw PDF Text Data</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {activeView === 'csv' ? (
          <div className="flex-1 bg-slate-950 p-4 sm:p-6 overflow-y-auto flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-200">PDF to GST CSV Converter</h2>
                <p className="text-xs text-slate-400">Non-AI table extraction — preview columns before download</p>
              </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-6xl mx-auto w-full space-y-4">
              <div
                onClick={() => !csvFile && csvInputRef.current?.click()}
                className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-500 transition"
              >
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm text-slate-300">
                  {csvFile ? csvFile.name : 'Click to upload PDF file'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Any PDF invoice — table columns will be detected automatically</p>
              </div>

              <input
                type="file"
                ref={csvInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setCsvFile(file);
                  setCsvContent('');
                  setCsvStatus('');
                }}
                accept=".pdf"
                className="hidden"
              />

              <div className="flex flex-col sm:flex-row gap-2 sm:space-x-3">
                <button
                  onClick={handleConvertPdfToCsv}
                  disabled={!csvFile || isCsvProcessing}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
                >
                  {isCsvProcessing ? 'Converting...' : 'Convert to CSV'}
                </button>

                {csvContent && (
                  <button
                    onClick={handleDownloadCsv}
                    className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-lg text-sm font-semibold transition"
                  >
                    Download CSV
                  </button>
                )}
              </div>

              {csvStatus && (
                <p className="text-xs text-slate-300 bg-slate-900/60 p-2 rounded border border-slate-700">
                  {csvStatus}
                </p>
              )}

              {csvContent && (() => {
                const lines = csvContent.split('\n').filter(l => l.trim().length > 0);
                if (lines.length === 0) return null;
                const parseCsvLine = (line: string) => {
                  const result: string[] = [];
                  const regex = /(?:^|,)"((?:[^"]|"")*)"|(?:^|,)([^,]*)/g;
                  let m: RegExpExecArray | null;
                  while ((m = regex.exec(line)) !== null) {
                    result.push((m[1] || m[2] || '').replace(/""/g, '"'));
                  }
                  return result;
                };
                const headers = parseCsvLine(lines[0]);
                const dataRows = lines.slice(1).map(parseCsvLine);
                const maxCols = Math.max(headers.length, ...dataRows.map(r => r.length));
                const displayHeaders = headers.length ? headers : Array.from({ length: maxCols }, (_, i) => `Col ${i + 1}`);
                return (
                  <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-auto max-h-96">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-800 text-slate-300 sticky top-0">
                        <tr>
                          {displayHeaders.slice(0, maxCols).map((h, i) => (
                            <th key={i} className="px-3 py-2 border-b border-slate-700 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataRows.slice(0, 200).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-800/60">
                            {Array.from({ length: maxCols }).map((_, j) => (
                              <td key={j} className="px-3 py-1.5 border-b border-slate-700/50 text-slate-300 whitespace-nowrap">
                                {row[j] || ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {dataRows.length > 200 && (
                      <p className="text-xs text-slate-500 p-2">Showing first 200 rows of {dataRows.length}</p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : activeTab === 'studio' ? (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

            <div className="w-full lg:w-4/12 bg-slate-900 border-r border-slate-800 flex flex-col p-3 sm:p-4 overflow-y-auto space-y-4">

              {isScannedPdf && (
                <div className="bg-purple-950/80 border border-purple-600/80 p-3.5 rounded-xl text-purple-200 text-xs flex flex-col space-y-2">
                  <div className="flex items-start space-x-2">
                    <Scan className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold block text-purple-300">Scanned / Image Invoice Detected</strong>
                      <span>Digital text layer missing. Choose an OCR method below to extract data.</span>
                    </div>
                  </div>

                  <div className="flex flex-col space-y-2 pt-1">
                    <div>
                      <p className="text-[10px] text-emerald-300 mb-1 font-semibold uppercase tracking-wider">Fast Local OCR (Free)</p>
                      <button
                        onClick={() => handleRunTesseractOcr('current')}
                        disabled={isProcessing}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white py-1 px-2.5 rounded text-[11px] font-semibold flex items-center justify-center space-x-1 transition disabled:opacity-50"
                      >
                        <Scan className="w-3.5 h-3.5" />
                        <span>Local OCR (Current Page)</span>
                      </button>
                    </div>
                    <div>
                      <p className="text-[10px] text-purple-300 mb-1 font-semibold uppercase tracking-wider">Optional: AI Verification</p>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleRunAiOcr('current')}
                          disabled={isProcessing || aiRateLimited}
                          className="bg-purple-600 hover:bg-purple-500 text-white py-1 px-2.5 rounded text-[11px] font-semibold flex items-center justify-center space-x-1 transition disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                          <span>AI OCR (Current Page)</span>
                        </button>
                        <button
                          onClick={() => handleRunAiOcr('all')}
                          disabled={isProcessing || aiRateLimited}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white py-1 px-2.5 rounded text-[11px] font-semibold flex items-center justify-center space-x-1 transition disabled:opacity-50"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-300" />
                          <span>AI OCR (All Pages)</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {tesseractProgress.status && (
                    <div className="bg-slate-900/60 border border-slate-700/50 p-2 rounded text-[11px] text-slate-300">
                      <div className="flex items-center space-x-2">
                        <RefreshCw className={`w-3 h-3 ${isProcessing ? 'animate-spin text-emerald-400' : 'text-slate-400'}`} />
                        <span>{tesseractProgress.status}</span>
                      </div>
                      {tesseractProgress.progress > 0 && (
                        <div className="mt-1.5 w-full bg-slate-800 rounded-full h-1.5">
                          <div
                            className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${Math.round(tesseractProgress.progress * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <MetadataPanel
                header={docHeaderInfo}
                onChange={setDocHeaderInfo}
                onSave={handleExportExcel}
              />

              <div className="bg-slate-800/80 border border-slate-700/80 p-3.5 rounded-xl space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                    <Filter className="w-4 h-4 text-emerald-400" />
                    <span>Table Y-Cutoff Boundaries</span>
                  </h3>
                </div>
              </div>

              <div
                className="bg-slate-800/80 border border-slate-700/80 p-3.5 rounded-xl flex flex-col flex-1 space-y-2"
              >
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="font-bold flex items-center space-x-1.5">
                    <Eye className="w-4 h-4 text-cyan-400" />
                    <span>Visual Page Preview</span>
                  </span>
                  {pdfDoc && (
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage <= 1}
                        className="p-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span>{currentPage} / {totalPages}</span>
                      <button
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage >= totalPages}
                        className="p-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div
                  onClick={() => !pdfDoc && fileInputRef.current?.click()}
                  className={`flex-1 bg-slate-950 rounded-lg overflow-auto border ${isDragging ? 'border-indigo-500 border-dashed' : 'border-slate-800'} flex items-center justify-center p-2 min-h-[260px] cursor-pointer group`}
                >
                  <canvas ref={canvasRef} className={`max-w-full h-auto rounded border border-slate-700/50 shadow-lg ${!pdfDoc && !isScannedPdf ? 'hidden' : 'block'}`} />

                  {!pdfDoc && !isScannedPdf && (
                    <div className="text-center p-6 text-slate-500 text-xs space-y-3 group-hover:text-slate-300 transition">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-full w-12 h-12 mx-auto flex items-center justify-center group-hover:border-indigo-500 transition">
                        <Upload className="w-6 h-6 text-slate-400 group-hover:text-indigo-400 transition" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-300">Click or Drag & Drop invoice file here</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">Supports PDF documents and JPG/PNG invoice images</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>

            <div className="flex-1 bg-slate-950 flex flex-col overflow-hidden">

              <div className="bg-slate-800/90 border-b border-slate-700/80 px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleAddRow}
                    className="flex items-center space-x-1 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Row</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-400">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoFillHeaderInfo}
                      onChange={(e) => setAutoFillHeaderInfo(e.target.checked)}
                      className="rounded bg-slate-900 border border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Auto-Fill Header Meta into Rows</span>
                  </label>
                </div>
              </div>

              <StudioTable
                data={tableData}
                onAddRow={handleAddRow}
                onDeleteRow={handleDeleteRow}
                onCellEdit={handleCellEdit}
              />

            </div>

          </div>
        ) : (
          <div className="flex-1 bg-slate-950 p-4 sm:p-6 overflow-y-auto flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-200">Raw PDF Text Line Inspection</h2>
                <p className="text-xs text-slate-400">View line-by-line text tokens extracted directly from PDF.js spatial coordinates</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter raw text..."
                  value={rawSearchTerm}
                  onChange={(e) => setRawSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 outline-none"
                />
              </div>
            </div>

            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-auto p-3 sm:p-3 sm:p-4 font-mono text-xs space-y-1">
              {rawTextLines.length > 0 ? (
                rawTextLines
                  .filter(line => !rawSearchTerm || line.text.toLowerCase().includes(rawSearchTerm.toLowerCase()))
                  .map((line, idx) => (
                    <div key={idx} className="flex items-center space-x-3 hover:bg-slate-800/60 p-1.5 rounded transition">
                      <span className="text-slate-600 w-10 text-right select-none">{idx + 1}</span>
                      <span className="text-indigo-400 text-[11px] w-20">Y: {line.y}px</span>
                      <span className="text-slate-200 flex-1">{line.text}</span>
                    </div>
                  ))
              ) : (
                <div className="text-center py-12 text-slate-500">
                  No raw text lines extracted yet. Upload a PDF to inspect raw tokens.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
