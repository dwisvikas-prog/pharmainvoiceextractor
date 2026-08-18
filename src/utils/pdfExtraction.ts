// @ts-nocheck
import * as pdfjsLib from 'pdfjs-dist';
import { ErpRow, RawTextLine, InvoiceHeader, groupTextIntoLines, detectTableBounds, mapColumns, buildTableRows } from './ocr';

export async function extractDataFromPage(doc: any, pageNum: number, headerInfo: InvoiceHeader): Promise<{
  rows: ErpRow[];
  supplier: string;
  billNo: string;
  date: string;
  lines: RawTextLine[];
} | null> {
  const page = await doc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1.0 });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;

  if (!textContent.items || textContent.items.length === 0) {
    return null;
  }

  const items = textContent.items.map((item: any) => {
    if (!Array.isArray(item?.transform) || item.transform.length < 6) return null;
    const tx = item.transform;
    const x = tx[4];
    const y = pageHeight - tx[5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      text: item.str,
      x: Math.round(x),
      y: Math.round(y),
      width: item.width || (item.str.length * 6),
      height: item.height || 10
    };
  }).filter((item: any) => item !== null && item.text.trim().length > 0);

  if (items.length === 0) return null;

  const sortedLines = groupTextIntoLines(items, pageHeight);
  const rawTextLines: RawTextLine[] = [];
  
  // Convert sorted lines back to RawTextLine format for detectInvoiceMetadata
  sortedLines.forEach(line => {
    rawTextLines.push({ y: line.y, text: line.text });
  });

  let detectedSupplier = headerInfo.supplier;
  let detectedBillNo = headerInfo.billNo;
  let detectedDate = headerInfo.date;

  const metadata = detectInvoiceMetadata(rawTextLines);
  if (metadata.supplier && !detectedSupplier) detectedSupplier = metadata.supplier;
  if (metadata.billNo && !detectedBillNo) detectedBillNo = metadata.billNo;
  if (metadata.date && !detectedDate) detectedDate = metadata.date;

  const { headerIndex } = detectTableBounds(sortedLines, pageHeight);

  let detectedColumns;
  if (headerIndex !== -1) {
    detectedColumns = mapColumns(sortedLines[headerIndex], pageWidth);
  } else {
    const defaultCols = ["ITEM NAME", "PACK", "BATCH", "EXPIRY", "QTY", "SRATE", "MRP", "AMOUNT"];
    const colWidth = pageWidth / defaultCols.length;
    detectedColumns = defaultCols.map((col, i) => ({
      xStart: i * colWidth,
      xEnd: (i + 1) * colWidth,
      xPos: i * colWidth + 10,
      rawHeader: col,
      erpCol: col
    }));
  }

  const topPixelLimit = 15 / 100 * pageHeight;
  const bottomPixelLimit = 85 / 100 * pageHeight;

  const tableDataLines = sortedLines.filter((line, idx) => {
    if (idx === headerIndex) return false;
    if (line.y < topPixelLimit || line.y > bottomPixelLimit) return false;
    return true;
  });

  const extractedRows = buildTableRows(tableDataLines, detectedColumns);

  return {
    rows: extractedRows,
    supplier: detectedSupplier,
    billNo: detectedBillNo,
    date: detectedDate,
    lines: sortedLines
  };
}

export async function extractAllPagesData(doc: any, headerInfo: InvoiceHeader): Promise<{
  rows: ErpRow[];
  supplier: string;
  billNo: string;
  date: string;
  isScanned: boolean;
  needsAiVerification: boolean;
}> {
  let combinedRows: ErpRow[] = [];
  let finalSupplier = headerInfo.supplier;
  let finalBillNo = headerInfo.billNo;
  let finalDate = headerInfo.date;

  for (let p = 1; p <= doc.numPages; p++) {
    const pageResult = await extractDataFromPage(doc, p, headerInfo);
    if (pageResult) {
      combinedRows = [...combinedRows, ...pageResult.rows];
      if (pageResult.supplier && !finalSupplier) finalSupplier = pageResult.supplier;
      if (pageResult.billNo && !finalBillNo) finalBillNo = pageResult.billNo;
      if (pageResult.date && !finalDate) finalDate = pageResult.date;
    }
  }

  combinedRows.forEach((r, idx) => {
    r["PSRLNO"] = String(idx + 1);
  });

  const validRows = combinedRows.filter(row => {
    const hasItemName = Boolean(row['ITEM NAME']?.trim());
    const hasInvoiceDetail = ['QTY', 'BATCH', 'EXPIRY', 'SRATE', 'MRP', 'AMOUNT']
      .some(column => Boolean(row[column]?.trim()));
    return hasItemName && hasInvoiceDetail;
  });
  const detailedRows = validRows.filter(row =>
    ['QTY', 'BATCH', 'EXPIRY', 'AMOUNT'].filter(column => Boolean(row[column]?.trim())).length >= 2
  );
  const needsAiVerification = combinedRows.length === 0 ||
    validRows.length !== combinedRows.length ||
    detailedRows.length < Math.ceil(combinedRows.length * 0.7);

  return {
    rows: combinedRows,
    supplier: finalSupplier,
    billNo: finalBillNo,
    date: finalDate,
    isScanned: combinedRows.length === 0,
    needsAiVerification
  };
}

export async function loadPdfDocument(file: File): Promise<any> {
  const fileArrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: fileArrayBuffer }).promise;
}

export function renderPdfPageToCanvas(
  pdfDoc: any,
  pageNum: number,
  canvas: HTMLCanvasElement,
  tableTopCutoff: number,
  tableBottomCutoff: number
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const ctx = canvas.getContext('2d')!;
      const viewport = page.getViewport({ scale: 1.2 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const topY = (tableTopCutoff / 100) * canvas.height;
      const bottomY = (tableBottomCutoff / 100) * canvas.height;

      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, topY);
      ctx.lineTo(canvas.width, topY);
      ctx.stroke();

      ctx.strokeStyle = '#EF4444';
      ctx.beginPath();
      ctx.moveTo(0, bottomY);
      ctx.lineTo(canvas.width, bottomY);
      ctx.stroke();

      ctx.setLineDash([]);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
