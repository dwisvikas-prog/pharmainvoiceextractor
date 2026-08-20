// @ts-nocheck
import * as pdfjsLib from 'pdfjs-dist';
import { ErpRow, RawTextLine, InvoiceHeader, groupTextIntoLines, detectTableBounds, mapColumns, buildTableRows, detectInvoiceMetadata } from './ocr';

export async function extractDataFromPage(doc: any, pageNum: number, headerInfo: InvoiceHeader, topCutoff = 12, bottomCutoff = 88, reuseColumns = null): Promise<{
  rows: ErpRow[];
  supplier: string;
  billNo: string;
  date: string;
  lines: RawTextLine[];
  columns: any[] | null;
  hasHeader: boolean;
} | null> {
  const page = await doc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1.0 });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;
  const isContinuation = pageNum > 1;

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
  sortedLines.forEach(line => {
    rawTextLines.push({ y: line.y, text: line.text });
  });

  let detectedSupplier = headerInfo.supplier;
  let detectedBillNo = headerInfo.billNo;
  let detectedDate = headerInfo.date;

  const metadata = detectInvoiceMetadata(rawTextLines.filter(line => line.y < (topCutoff / 100) * pageHeight));
  if (!metadata.supplier && !metadata.billNo && !metadata.date) {
    const fallback = detectInvoiceMetadata(rawTextLines);
    if (fallback.supplier) metadata.supplier = fallback.supplier;
    if (fallback.billNo) metadata.billNo = fallback.billNo;
    if (fallback.date) metadata.date = fallback.date;
  }
  if (metadata.supplier && !detectedSupplier) detectedSupplier = metadata.supplier;
  if (metadata.billNo && !detectedBillNo) detectedBillNo = metadata.billNo;
  if (metadata.date && !detectedDate) detectedDate = metadata.date;

  const { headerIndex } = detectTableBounds(sortedLines, pageHeight);
  const hasHeader = headerIndex !== -1;

  let detectedColumns = null;
  if (hasHeader) {
    detectedColumns = mapColumns(sortedLines[headerIndex], pageWidth);
  } else if (reuseColumns?.length) {
    detectedColumns = reuseColumns;
  } else {
    const defaultCols = ["ITEM NAME", "PACK", "BATCH", "EXPIRY", "QTY", "FTRATE", "MRP", "AMOUNT"];
    const colWidth = pageWidth / defaultCols.length;
    detectedColumns = defaultCols.map((col, i) => ({
      xStart: i * colWidth,
      xEnd: (i + 1) * colWidth,
      xPos: i * colWidth + 10,
      rawHeader: col,
      erpCol: col
    }));
  }

  const effectiveTop = isContinuation && !hasHeader ? Math.min(topCutoff, 5) : topCutoff;
  const effectiveBottom = isContinuation && !hasHeader ? Math.max(bottomCutoff, 96) : bottomCutoff;
  const topPixelLimit = effectiveTop / 100 * pageHeight;
  const bottomPixelLimit = effectiveBottom / 100 * pageHeight;

  const tableDataLines = sortedLines.filter((line, idx) => {
    if (hasHeader && idx === headerIndex) return false;
    if (line.y < topPixelLimit || line.y > bottomPixelLimit) return false;
    return true;
  });

  const extractedRows = buildTableRows(tableDataLines, detectedColumns);
  const itemRows = extractedRows.filter(row => Boolean(String(row['ITEM NAME'] || '').trim()));
  itemRows.forEach(row => {
    if (!row["SUPPLIER"]) row["SUPPLIER"] = detectedSupplier || "";
    if (!row["BILL NO."]) row["BILL NO."] = detectedBillNo || "";
    if (!row["DATE"]) row["DATE"] = detectedDate || "";
  });

  return {
    rows: itemRows,
    supplier: detectedSupplier,
    billNo: detectedBillNo,
    date: detectedDate,
    lines: sortedLines,
    columns: hasHeader ? detectedColumns : reuseColumns,
    hasHeader
  };
}

export async function extractAllPagesData(doc: any, headerInfo: InvoiceHeader, topCutoff = 12, bottomCutoff = 88): Promise<{
  rows: ErpRow[];
  supplier: string;
  billNo: string;
  date: string;
  isScanned: boolean;
  needsAiVerification: boolean;
  pagesNeedingOcr: number[];
}> {
  let combinedRows: ErpRow[] = [];
  let finalSupplier = headerInfo.supplier;
  let finalBillNo = headerInfo.billNo;
  let finalDate = headerInfo.date;

  let sharedColumns = null;
  const pagesNeedingOcr: number[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const pageResult = await extractDataFromPage(doc, p, headerInfo, topCutoff, bottomCutoff, sharedColumns);
    if (pageResult) {
      if (pageResult.hasHeader && pageResult.columns) sharedColumns = pageResult.columns;
      combinedRows = [...combinedRows, ...pageResult.rows];
      if (pageResult.supplier && !finalSupplier) finalSupplier = pageResult.supplier;
      if (pageResult.billNo && !finalBillNo) finalBillNo = pageResult.billNo;
      if (pageResult.date && !finalDate) finalDate = pageResult.date;
      if (pageResult.rows.length === 0) pagesNeedingOcr.push(p);
    } else {
      pagesNeedingOcr.push(p);
    }
  }

  combinedRows.forEach((r, idx) => {
    r["PSRLNO"] = String(idx + 1);
    if (!r["SUPPLIER"]) r["SUPPLIER"] = finalSupplier || "";
    if (!r["BILL NO."]) r["BILL NO."] = finalBillNo || "";
    if (!r["DATE"]) r["DATE"] = finalDate || "";
  });

  const validRows = combinedRows.filter(row => {
    const hasItemName = Boolean(row['ITEM NAME']?.trim());
    const hasInvoiceDetail = ['QTY', 'BATCH', 'EXPIRY', 'FTRATE', 'SRATE', 'MRP', 'AMOUNT']
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
    isScanned: combinedRows.length === 0 || pagesNeedingOcr.length > 0,
    needsAiVerification,
    pagesNeedingOcr
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
  tableBottomCutoff: number,
  rotation = 0
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const ctx = canvas.getContext('2d')!;
      const viewport = page.getViewport({ scale: 1.2, rotation });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
