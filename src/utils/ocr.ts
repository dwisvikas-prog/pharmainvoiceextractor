// @ts-nocheck
import { ERP_COLUMNS, HEADER_SYNONYMS, HEADER_KEYWORDS } from './constants';
import Tesseract from 'tesseract.js';

const GEMINI_OCR_MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash'; // Better extraction
const GEMINI_OCR_MODEL_FALLBACK = 'gemini-3.5-flash-lite'; // Fallback if needed

export interface ErpRow {
  [col: string]: string;
}

export interface InvoiceHeader {
  supplier: string;
  billNo: string;
  date: string;
}

export interface RawTextLine {
  y: number;
  text: string;
}

// ==================== HEADER DETECTION ====================

export function detectInvoiceMetadata(lines: RawTextLine[]): InvoiceHeader {
  const header: InvoiceHeader = { supplier: '', billNo: '', date: '' };
  const junkWords = [
    'BANK', 'OUR', 'DETAILS', 'TERMS', 'CONDITIONS', 'AUTHORIZED', 'SIGNATURE',
    'DECLARATION', 'NOTE', 'MSG', 'INTEREST', 'POSSESSION', 'JURISDICTION', 'ACK',
    'IRN', 'SCHEME', 'CLASS', 'ROUND', 'TAXABLE', 'WEIGHT', 'CASES', 'EXCHANGED',
    'TRANSPORT', 'VEHICLE', 'RECEIVER', 'BILLED', 'GOODS', 'INVOICE', 'ORDER',
    'EWAY', 'WAY', 'GRAND', 'SUB', 'TOTAL', 'AMOUNT', 'VALUE', 'QTY', 'RATE',
    'MRP', 'FREE', 'BATCH', 'EXP', 'PACK', 'HSN', 'SR', 'ITEM', 'PRODUCT',
    'CODE', 'BARCODE', 'COMPANY', 'SUPPLIER', 'BILL', 'DATE', 'NO', 'YES', 'NA',
    'N/A', 'NIL', 'DIS', 'RS', 'PER', 'MFR', 'MFG', 'BRAND'
  ];

  for (const line of lines.slice(0, 30)) {
    const upper = line.text.toUpperCase();

    // Bill number detection
    if (!header.billNo && (upper.includes('BILL') || upper.includes('INVOICE') || upper.includes('INV'))) {
      const match = line.text.match(/(?:BILL|INV|INVOICE)\s*(?:NO|NUMBER)?[:.\-\s]*([A-Z0-9\/\-]+)/i);
      if (match && match[1]) {
        header.billNo = match[1].trim();
        continue;
      }
    }
    // Fallback: "No:" or "Number:" pattern
    if (!header.billNo && /\b(?:NO|NUMBER)\b/i.test(line.text)) {
      const match = line.text.match(/\b(?:NO|NUMBER)\b\s*[:.\-\s]*([A-Z0-9]{3,20}(?:\/[A-Z0-9]+)?)/i);
      if (match && match[1]) {
        header.billNo = match[1].trim();
        continue;
      }
    }

    // Date detection
    if (!header.date && (upper.includes('DATE') || upper.includes('DATED'))) {
      const match = line.text.match(/\d{2}[-/\.]\d{2}[-/\.]\d{2,4}/);
      if (match) {
        header.date = match[0];
        continue;
      }
    }

    // Supplier detection
    if (!header.supplier && (upper.includes('PHARMA') || upper.includes('DISTRIBUTOR') || upper.includes('AGENCIES') || upper.includes('LIMITED'))) {
      const hasJunk = junkWords.some(word => upper.includes(word));
      if (!hasJunk && line.text.length > 5 && line.text.length < 80) {
        header.supplier = line.text.replace(/[^a-zA-Z0-9\s&().,/-]/g, '').trim();
      }
    }
  }

  return header;
}

// ==================== PRODUCT NAME CLEANING ====================

export function cleanAndPurifyProductName(rawName: string, rowRef: ErpRow): string {
  if (!rawName) return "";
  let str = rawName.toString().trim();

  const junkWords = [
    'TOTAL', 'GRAND', 'SUB', 'BANK', 'IFSC', 'A/C', 'ROUND', 'TERMS',
    'CONDITIONS', 'AUTHORIZED', 'SIGNATURE', 'DECLARATION', 'NOTE', 'E&OE',
    'IGST', 'CGST', 'SGST', 'GST', 'AMOUNT'
  ];
  for (const word of junkWords) {
    const regex = new RegExp("\\b" + word + "\\b", "gi");
    str = str.replace(regex, "");
  }

  str = str.replace(/\s+/g, " ").trim();
  str = str.replace(/^[\.\,\-\/\:]+|[\.\,\-\/\:]+$/g, "").trim();

  if (str.length > 2 && rowRef) {
    const hsnMatch = rawName.match(/\b(30\d{6}|84\d{6}|90\d{6}|\d{8})\b/);
    if (hsnMatch && !rowRef["HSNCODE"]) rowRef["HSNCODE"] = hsnMatch[1];

    const expMatch = rawName.match(/\b(0[1-9]|1[0-2])\/(\d{2}|\d{4})\b/);
    if (expMatch && !rowRef["EXPIRY"]) rowRef["EXPIRY"] = expMatch[1];

    const packMatch = rawName.match(/\b(\d+\s*[\*xX]\s*\d+|\d+[`']?[sS])\b/);
    if (packMatch && !rowRef["PACK"]) rowRef["PACK"] = packMatch[1];

    const batchMatch = rawName.match(/\b([A-Z]{2,4}\d{5,8}[A-Z]?|[A-Z]\d{6,8})\b/);
    if (batchMatch && !rowRef["BATCH"]) rowRef["BATCH"] = batchMatch[1];
  }

  return str;
}

// ==================== ROW NORMALIZATION ====================

export function normalizeToErpRows(
  rawItems: any[],
  header: InvoiceHeader,
  autoFillHeader: boolean,
  startIndex: number = 1
): ErpRow[] {
  return rawItems
    .map(item => {
      const fullRow: ErpRow = {};
      ERP_COLUMNS.forEach(col => fullRow[col] = "");

      Object.keys(item).forEach(key => {
        const upperKey = key.toUpperCase();
        const normalizedKey = key.toLowerCase().replace(/[._-]/g, '').replace(/\s+/g, '');
        if (['ftrate', 'frate', 'rate', 'prate', 'price'].includes(normalizedKey)) {
          fullRow["FTRATE"] = String(item[key] || "");
        } else if (ERP_COLUMNS.includes(upperKey)) {
          fullRow[upperKey] = String(item[key] || "");
        }
      });

      fullRow["ITEM NAME"] = cleanAndPurifyProductName(fullRow["ITEM NAME"] || item["ITEM NAME"], fullRow);

      if (autoFillHeader) {
        fullRow["SUPPLIER"] = header.supplier || "";
        fullRow["BILL NO."] = header.billNo || "";
        fullRow["DATE"] = header.date || "";
      }

      return fullRow;
    })
    .filter(row => row["ITEM NAME"])
    .map((row, idx) => {
      row["PSRLNO"] = String(startIndex + idx);
      return row;
    });
}

// ==================== PDF TEXT EXTRACTION HELPERS ====================

export function groupTextIntoLines(
  items: any[],
  pageHeight: number
): { y: number; items: any[]; text: string }[] {
  const lineMap = new Map<number, any[]>();

  items.forEach((item: any) => {
    // Skip invalid items
    if (!item || !item.transform || !Array.isArray(item.transform) || item.transform.length < 6) {
      console.warn("Skipping invalid text item:", item);
      return;
    }
    
    const tx = item.transform;
    const x = tx[4];
    const y = pageHeight - tx[5];
    const textItem = { text: item.str, x: Math.round(x), y: Math.round(y), width: item.width || (item.str.length * 6) };

    let foundLineY: number | null = null;
    for (const yKey of lineMap.keys()) {
      if (Math.abs(yKey - textItem.y) <= 4) {
        foundLineY = yKey;
        break;
      }
    }

    if (foundLineY !== null) {
      lineMap.get(foundLineY)!.push(textItem);
    } else {
      lineMap.set(textItem.y, [textItem]);
    }
  });

  const sortedYKeys = Array.from(lineMap.keys()).sort((a, b) => a - b);
  return sortedYKeys.map(y => {
    const lineItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
    const fullText = lineItems.map(i => i.text.trim()).join(' ');
    return { y, items: lineItems, text: fullText };
  });
}

export function detectTableBounds(
  sortedLines: { y: number; items: any[]; text: string }[],
  pageHeight: number
): { headerIndex: number; topY: number; bottomY: number } {
  let headerIndex = -1;
  let detectedTopY = 15;
  let detectedBottomY = 85;

  for (let i = 0; i < sortedLines.length; i++) {
    const lineText = sortedLines[i].text.toUpperCase();
    const matchesHeaderKeywords = HEADER_KEYWORDS.filter(kw => lineText.includes(kw)).length;

    if (matchesHeaderKeywords >= 2) {
      headerIndex = i;
      detectedTopY = Math.max(5, Math.floor((sortedLines[i].y / pageHeight) * 100) - 1);
      break;
    }
  }

  const footerKeywords = [
    'GRAND TOTAL', 'SUB TOTAL', 'SUBTOTAL', 'TERMS &', 'BANK DETAILS',
    'AMOUNT IN WORDS', 'OUR BANK', 'IFSC', 'A/C NO', 'ACK NO', 'IRN NO',
    'AUTHORIZED', 'ROUND OFF', 'ROUNDOFF', 'IGST', 'TOTAL ITEMS', 'TOTAL QTY'
  ];

  for (let i = headerIndex + 1; i < sortedLines.length; i++) {
    const lineText = sortedLines[i].text.toUpperCase();
    if (footerKeywords.some(kw => lineText.includes(kw))) {
      detectedBottomY = Math.min(95, Math.ceil((sortedLines[i].y / pageHeight) * 100));
      break;
    }
  }

  return { headerIndex, topY: detectedTopY, bottomY: detectedBottomY };
}

export function mapColumns(
  headerLine: { y: number; items: any[]; text: string },
  pageWidth: number
): { xStart: number; xEnd: number; xPos: number; rawHeader: string; erpCol: string }[] {
  const sortedHeaderItems = [...headerLine.items].sort((a: any, b: any) => a.x - b.x);

  const rawHeaderList = sortedHeaderItems.map((hItem: any) => {
    const textUpper = hItem.text.trim().toUpperCase();
    let matchedErpCol = "ITEM NAME";

    const ftrateAliases = ["FTRATE", "F RATE", "F.RATE", "F-RATE", "F_RATE", "RATE", "PRATE", "P RATE", "P.RATE", "PRICE"];
    if (ftrateAliases.includes(textUpper)) {
      matchedErpCol = "FTRATE";
    }

    if (matchedErpCol === "ITEM NAME") {
      for (const [erpCol, synonyms] of Object.entries(HEADER_SYNONYMS)) {
        if (synonyms.some(s => textUpper === s)) {
          matchedErpCol = erpCol;
          break;
        }
      }
    }

    if (matchedErpCol === "ITEM NAME") {
      for (const [erpCol, synonyms] of Object.entries(HEADER_SYNONYMS)) {
        if (synonyms.some(s => textUpper.includes(s))) {
          matchedErpCol = erpCol;
          break;
        }
      }
    }

    return { x: hItem.x, width: hItem.width, rawText: hItem.text.trim(), erpCol: matchedErpCol };
  });

  return rawHeaderList.map((col, idx) => {
    const prevCol = rawHeaderList[idx - 1];
    const nextCol = rawHeaderList[idx + 1];

    let xStart = prevCol ? prevCol.x + (col.x - prevCol.x) / 2 : 0;
    let xEnd = nextCol ? col.x + (nextCol.x - col.x) / 2 : pageWidth;

    return { xStart, xEnd, xPos: col.x, rawHeader: col.rawText, erpCol: col.erpCol };
  });
}

export function buildTableRows(
  tableDataLines: { y: number; items: any[]; text: string }[],
  detectedColumns: { xStart: number; xEnd: number; xPos: number; rawHeader: string; erpCol: string }[]
): ErpRow[] {
  const extractedRows: ErpRow[] = [];

  for (const line of tableDataLines) {
    const rowObj: ErpRow = {};
    ERP_COLUMNS.forEach(col => rowObj[col] = "");

    const colTokenMap: { [key: string]: string[] } = {};
    detectedColumns.forEach(col => colTokenMap[col.erpCol] = []);

    for (const item of line.items) {
      for (const colDef of detectedColumns) {
        if (item.x >= colDef.xStart && item.x < colDef.xEnd) {
          colTokenMap[colDef.erpCol].push(item.text.trim());
          break;
        }
      }
    }

    Object.keys(colTokenMap).forEach(colName => {
      const tokens = colTokenMap[colName];
      if (tokens.length > 0) {
        rowObj[colName] = tokens.join(' ').trim();
      }
    });

    rowObj["_RAW_TEXT"] = line.text;
    extractedRows.push(rowObj);
  }

  return extractedRows;
}

// ==================== EXCEL/TEXT PARSERS ====================

export function parseWithHeadersFormat(jsonData: any[]): ErpRow[] {
  const headers = jsonData[0].map((h: any) => String(h).trim().toUpperCase());

  const colMapping: { [key: number]: string } = {};
  headers.forEach((header, idx) => {
    for (const [erpCol, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (synonyms.some(s => header === s)) {
        colMapping[idx] = erpCol;
        break;
      }
    }

    if (!colMapping[idx]) {
      for (const [erpCol, synonyms] of Object.entries(HEADER_SYNONYMS)) {
        if (synonyms.some(s => header.includes(s) || s.includes(header))) {
          colMapping[idx] = erpCol;
          break;
        }
      }
    }
  });

  const rows: ErpRow[] = [];
  for (let i = 1; i < jsonData.length; i++) {
    const row = jsonData[i];
    const rowObj: ErpRow = {};
    ERP_COLUMNS.forEach(col => rowObj[col] = "");

    headers.forEach((header, idx) => {
      if (colMapping[idx]) {
        const val = row[idx] !== undefined ? String(row[idx]).trim() : "";
        rowObj[colMapping[idx]] = val;
      }
    });

    rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
    rows.push(rowObj);
  }

  return rows;
}

export function parseNoHeaderFormat(jsonData: any[]): { rows: ErpRow[]; header: InvoiceHeader } {
  let headerInfo: InvoiceHeader = { supplier: "", billNo: "", date: "" };
  const rows: ErpRow[] = [];

  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i];
    const rowType = String(row[0] || "").trim().toUpperCase();

    if (rowType === "H") {
      headerInfo.supplier = String(row[2] || "").trim();
      headerInfo.billNo = String(row[3] || "").trim();
      headerInfo.date = String(row[4] || "").trim();
      continue;
    }

    if (rowType === "T") {
      const rowObj: ErpRow = {};
      ERP_COLUMNS.forEach(col => rowObj[col] = "");

      rowObj["SUPPLIER"] = String(row[2] || "").trim();
      rowObj["COMPANY"] = String(row[2] || "").trim();
      rowObj["ITEM NAME"] = String(row[5] || "").trim();
      rowObj["PACK"] = String(row[6] || "").trim();
      rowObj["BATCH"] = String(row[8] || "").trim();
      rowObj["EXPIRY"] = String(row[9] || "").trim();
      rowObj["QTY"] = String(row[11] || "").trim();
      rowObj["MRP"] = String(row[13] || "").trim();
      rowObj["SRATE"] = String(row[15] || "").trim();
      rowObj["AMOUNT"] = String(row[16] || "").trim();

      rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
      rows.push(rowObj);
    }
  }

  return { rows, header: headerInfo };
}

export function parsePipeDelimitedFormat(lines: string[]): ErpRow[] {
  const rows: ErpRow[] = [];

  for (const line of lines) {
    const fields = line.split('|').map(f => f.trim()).slice(1);

    if (fields.length === 0) continue;

    const rowObj: ErpRow = {};
    ERP_COLUMNS.forEach(col => rowObj[col] = "");

    fields.forEach((field, idx) => {
      if (idx < ERP_COLUMNS.length) {
        rowObj[ERP_COLUMNS[idx]] = field;
      }
    });

    rowObj["_RAW_TEXT"] = fields.join(' | ');
    rows.push(rowObj);
  }

  return rows;
}

// ==================== TESSERACT OCR PARSER ====================

export function parseTesseractTextToStructuredData(
  rawText: string,
  headerInfo: InvoiceHeader,
  autoFillHeader: boolean
): { items: ErpRow[]; header: InvoiceHeader } {
  if (!rawText || rawText.trim().length === 0) {
    return { items: [], header: headerInfo };
  }

  const lines = rawText.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 2);

  let detectedSupplier = headerInfo.supplier || '';
  let detectedBillNo = headerInfo.billNo || '';
  let detectedDate = headerInfo.date || '';

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    if (!detectedSupplier && (upper.includes('PHARMA') || upper.includes('DISTRIBUTOR') || upper.includes('AGENCIES') || upper.includes('LIMITED'))) {
      if (line.length > 5 && line.length < 80 && !upper.includes('BILL')) {
        detectedSupplier = line.replace(/[^a-zA-Z0-9\s&().,/-]/g, '').trim();
      }
    }

    if (!detectedBillNo && (upper.includes('BILL') || upper.includes('INVOICE') || upper.includes('INV'))) {
      const match = line.match(/(?:BILL|INV|INVOICE)\s*(?:NO|NUMBER)?[:.\-\s]*([A-Z0-9\/\-]+)/i);
      if (match && match[1]) detectedBillNo = match[1].trim();
    }
    if (!detectedBillNo && /\b(?:NO|NUMBER)\b/i.test(line)) {
      const match = line.match(/\b(?:NO|NUMBER)\b\s*[:.\-\s]*([A-Z0-9]{3,20}(?:\/[A-Z0-9]+)?)/i);
      if (match && match[1]) detectedBillNo = match[1].trim();
    }

    if (!detectedDate && (upper.includes('DATE') || upper.includes('DATED'))) {
      const match = line.match(/(\d{2}[-\/\.]\d{2}[-\/\.]\d{2,4})/);
      if (match) detectedDate = match[1];
    }
  }

  const items: ErpRow[] = [];
  let tableStarted = false;
  let tableEnded = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    const headerMatches = HEADER_KEYWORDS.filter(kw => upper.includes(kw)).length;
    if (!tableStarted && headerMatches >= 2) {
      tableStarted = true;
      continue;
    }

    if (tableStarted && !tableEnded) {
      if (
        upper.includes('GRAND TOTAL') || upper.includes('SUB TOTAL') ||
        upper.includes('SUBTOTAL') || upper.includes('TERMS &') ||
        upper.includes('BANK DETAILS') || upper.includes('AMOUNT IN WORDS') ||
        upper.includes('OUR BANK') || upper.includes('IFSC') ||
        upper.includes('A/C NO') || upper.includes('ACK NO') ||
        upper.includes('IRN NO') || upper.includes('AUTHORIZED') ||
        upper.includes('ROUND OFF') || upper.includes('ROUNDOFF') ||
        /IGST\s*\d+/.test(upper) || /IGST\s+PAY/.test(upper) ||
        upper.includes('TOTAL ITEMS') || upper.includes('TOTAL QTY')
      ) {
        tableEnded = true;
        continue;
      }

      const itemName = cleanAndPurifyProductName(line);
      if (itemName && itemName.length > 1 && !HEADER_KEYWORDS.some(kw => upper === kw)) {
        const row: ErpRow = {};
        ERP_COLUMNS.forEach(col => row[col] = "");

        row["SUPPLIER"] = autoFillHeader ? (detectedSupplier || headerInfo.supplier || '') : '';
        row["BILL NO."] = autoFillHeader ? (detectedBillNo || headerInfo.billNo || '') : '';
        row["DATE"] = autoFillHeader ? (detectedDate || headerInfo.date || '') : '';
        row["ITEM NAME"] = itemName;

        const hsnMatch = line.match(/\b(30\d{6}|84\d{6}|90\d{6}|\d{8})\b/);
        if (hsnMatch) row["HSNCODE"] = hsnMatch[1];

        const expMatch = line.match(/\b(0[1-9]|1[0-2])\/(\d{2}|\d{4})\b/);
        if (expMatch) row["EXPIRY"] = expMatch[1];

        const packMatch = line.match(/\b(\d+\s*[\*xX]\s*\d+|\d+[`']?[sS])\b/);
        if (packMatch) row["PACK"] = packMatch[1];

        const batchMatch = line.match(/\b([A-Z]{2,4}\d{5,8}[A-Z]?|[A-Z]\d{6,8})\b/);
        if (batchMatch) row["BATCH"] = batchMatch[1];

        const numberPattern = /\b\d+(?:\.\d+)?\b/g;
        const numbers = line.match(numberPattern) || [];

        if (numbers.length >= 1) {
          const lastNum = numbers[numbers.length - 1];
          if (lastNum.includes('.')) {
            row["MRP"] = lastNum;
          } else {
            row["QTY"] = lastNum;
          }
        }

        if (numbers.length >= 2) {
          const secondLast = numbers[numbers.length - 2];
          if (secondLast.includes('.')) {
            row["FTRATE"] = secondLast;
          }
        }

        if (numbers.length >= 3) {
          const thirdLast = numbers[numbers.length - 3];
          if (thirdLast.includes('.')) {
            row["AMOUNT"] = thirdLast;
          }
        }

        const gstMatch = line.match(/(?:CGST|SGST|IGST|GST)\s*@?\s*(\d+(?:\.\d+)?)\s*%/i);
        if (gstMatch) {
          const gstVal = gstMatch[1];
          if (upper.includes('CGST') || upper.includes('C-GST')) row["CGST"] = gstVal;
          else if (upper.includes('SGST') || upper.includes('UTGST') || upper.includes('S-GST')) row["SGST"] = gstVal;
          else if (upper.includes('IGST') || upper.includes('I-GST')) row["IGST"] = gstVal;
        }

        items.push(row);
      }
    }
  }

  return {
    items,
    header: { supplier: detectedSupplier, billNo: detectedBillNo, date: detectedDate }
  };
}

// ==================== OCR FUNCTIONS ====================

function getGeminiApiKeys(): string[] {
  const keys: string[] = [];
  const primary = import.meta.env.VITE_GEMINI_API_KEY;
  if (primary) keys.push(primary);
  for (let i = 2; i <= 10; i++) {
    const key = import.meta.env[`VITE_GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }
  return keys;
}

async function callGeminiWithRotation(payload: any): Promise<string> {
  const apiKeys = getGeminiApiKeys();
  if (apiKeys.length === 0) throw new Error("No Gemini API keys found");
  
  const modelsToTry = [GEMINI_OCR_MODEL, GEMINI_OCR_MODEL_FALLBACK];
  
  for (const model of modelsToTry) {
    console.log(`🚀 Trying: ${model}`);
    const apiUrlBase = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      const apiKey = apiKeys[keyIndex];
      const apiUrl = `${apiUrlBase}?key=${apiKey}`;
      
      try {
        console.log(`📤 Uploading to API (Key ${keyIndex + 1})...`);
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        
        if (!response.ok) {
          const errText = await response.text();
          console.error(`❌ ${response.status}: ${errText}`);
          const error = new Error(`Gemini Vision API Error (${response.status}): ${errText}`) as Error & { status?: number };
          error.status = response.status;
          throw error;
        }
        
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          console.error("❌ No text in response:", JSON.stringify(result));
          throw new Error("No text returned from Gemini");
        }
        
        console.log(`✅ Success with ${model}, Response length: ${text.length}`);
        console.log("Response preview:", text.substring(0, 200));
        return text;
      } catch (err: any) {
        const status = err.status || 0;
        console.error(`Key ${keyIndex + 1} (${model}) failed:`, err.message);
        
        // 429/503 = Rate limit, skip to next key immediately
        if ((status === 503 || status === 429) && keyIndex < apiKeys.length - 1) {
          console.log(`⏭️  Rotating to next API key...`);
          continue;
        }
        
        // 404 = Model not available, try next model
        if (status === 404) {
          console.log(`⏭️  Model ${model} not available, trying fallback...`);
          break;
        }
      }
    }
  }
  
  throw new Error(`All AI models exhausted. Falling back to Local OCR (Tesseract).`);
}

export async function performGeminiOcrOnCanvas(canvas: HTMLCanvasElement): Promise<any> {
  if (!canvas) throw new Error("Canvas element unavailable for OCR");

  const { base64Data, mimeType } = prepareCanvasForGemini(canvas);

  const userPrompt = `You are an expert pharmaceutical document parser and OCR AI. Extract structured header and line-item data from this pharmaceutical invoice image into strict JSON format.

### EXTRACTION RULES:
1. HEADER METADATA (CRITICAL - DO NOT SKIP):
   - Identify the Supplier / Distributor Name, Bill/Invoice Number, and Bill Date.
   - Look for ALL variations: "Bill No", "Invoice No", "Inv No", "Bill Number", "Invoice Number", "No.", "No", "B.No", "Bill#" etc.
   - The bill/invoice number is typically an alphanumeric code like MK010343, INV-1234, etc.

2. PRODUCT LINE ITEMS:
   - Extract all product lines from the main invoice table. Ignore headers, sub-totals, bank details, terms & conditions, e-way bill details, and footer text.
   - Isolate the clean "ITEM NAME" (Drug / Medicine Brand Name). Do NOT combine pack size, batch number, expiry date, HSN, or rate into the item name field unless it is intrinsically part of the brand name.

3. FIELD MAPPING:
   - "ITEM NAME": Medicine/Drug name (e.g., "DAPAHENZ M 10/500", "GLIMY M1 FORTE").
   - "PACK": Packaging unit (e.g., "10'S", "1*10", "10 TAB", "STRIP").
   - "BATCH": Batch or Lot Number (e.g., "EMV242373C", "E2600061").
   - "EXPIRY": Expiry date in MM/YY or MM/YYYY format (e.g., "10/26", "11/27").
   - "QTY": Billed Quantity (numeric or string count).
   - "F.QTY": Free/Scheme/Bonus Quantity (default to "0" if missing).
  - "FTRATE": Any field/header named FTRATE, F RATE, F.RATE, RATE, PRATE, P.RATE, or PRICE.
  - "SRATE": Sale rate only when the source explicitly says SRATE, S.RATE, or S RATE. Never put a generic RATE/PRICE/PRATE value here.
   - "MRP": Maximum Retail Price.
   - "DIS": Discount percentage or discount amount.
   - "AMOUNT": Total taxable/net amount for the line item.
   - "HSNCODE": HSN / SAC 8-digit or 6-digit code (e.g., "30049099").
   - "CGST": CGST percentage rate or amount.
   - "SGST": SGST/UTGST percentage rate or amount.
   - "IGST": IGST percentage rate or amount.
   - "COMPANY": Manufacturer or Pharmaceutical brand company name (e.g., "LARENO", "DR REDDY").

4. STRICT JSON OUTPUT:
   - Output ONLY a single JSON object matching the required schema.`;

  const payload = {
    contents: [{
      role: "user",
      parts: [
        { text: userPrompt },
        {
          inlineData: {
            mimeType,
            data: base64Data
          }
        }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const rawResponse = await callGeminiWithRotation(payload);
  console.log("📝 Raw Gemini response:", rawResponse.substring(0, 300));
  
  try {
    let parsed = JSON.parse(rawResponse);
    
    // Handle different response formats from Gemini
    // Format 1: { header_metadata: {...}, line_items: [...] }
    if (parsed.header_metadata) {
      parsed = {
        supplier: parsed.header_metadata.supplier_name || parsed.header_metadata.supplier || '',
        billNo: parsed.header_metadata.invoice_number || parsed.header_metadata.billNo || '',
        date: parsed.header_metadata.invoice_date || parsed.header_metadata.date || '',
        items: parsed.line_items || parsed.items || []
      };
    }
    // Format 2: { header: {...}, line_items: [...] }
    else if (parsed.header && !parsed.supplier) {
      parsed = {
        supplier: parsed.header.supplier_name || parsed.header.supplier || '',
        billNo: parsed.header.invoice_number || parsed.header.billNo || '',
        date: parsed.header.invoice_date || parsed.header.date || '',
        items: parsed.line_items || parsed.items || []
      };
    } 
    // Format 3: Ensure items field exists
    else if (!parsed.items && parsed.line_items) {
      parsed.items = parsed.line_items;
    }
    
    // Normalize field names in items
    if (parsed.items && Array.isArray(parsed.items)) {
      parsed.items = parsed.items.map((item: any) => {
        const normalized: any = {};
        for (const [key, value] of Object.entries(item)) {
          const lowerKey = key.toLowerCase();
          // Map common variations
          if (lowerKey.includes('item_name') || lowerKey.includes('product_name') || lowerKey === 'name') normalized['ITEM NAME'] = value;
          else if (lowerKey.includes('hsncode') || lowerKey.includes('hsn_code') || lowerKey === 'hsn') normalized['HSNCODE'] = value;
          else if (lowerKey === 'pack' || lowerKey.includes('packing')) normalized['PACK'] = value;
          else if (lowerKey === 'batch' || lowerKey.includes('batch')) normalized['BATCH'] = value;
          else if (lowerKey === 'company' || lowerKey.includes('manufacturer')) normalized['COMPANY'] = value;
          else if (lowerKey === 'expiry' || lowerKey.includes('exp')) normalized['EXPIRY'] = value;
          else if (lowerKey === 'qty' || lowerKey.includes('quantity')) normalized['QTY'] = value;
          else if (lowerKey.includes('free') || lowerKey === 'f_qty') normalized['F.QTY'] = value;
          else if (lowerKey === 'srate' || lowerKey === 's.rate' || lowerKey === 's rate') normalized['SRATE'] = value;
          else if (['ftrate', 'f rate', 'f.rate', 'f-rate', 'f_rate', 'frate', 'rate', 'prate', 'p rate', 'p.rate', 'price'].includes(lowerKey)) normalized['FTRATE'] = value;
          else if (lowerKey === 'mrp' || lowerKey === 'mfp') normalized['MRP'] = value;
          else if (lowerKey === 'discount' || lowerKey === 'dis') normalized['DIS'] = value;
          else if (lowerKey === 'amount' || lowerKey === 'total') normalized['AMOUNT'] = value;
          else if (lowerKey === 'cgst' || lowerKey.includes('cgst')) normalized['CGST'] = value;
          else if (lowerKey === 'sgst' || lowerKey.includes('sgst')) normalized['SGST'] = value;
          else if (lowerKey === 'igst' || lowerKey.includes('igst')) normalized['IGST'] = value;
          else normalized[key.toUpperCase()] = value;
        }
        return normalized;
      });
    }
    
    console.log("✅ Normalized response:", JSON.stringify(parsed).substring(0, 200));
    return parsed;
  } catch (parseErr) {
    console.error("❌ JSON Parse Error:", parseErr, "\nRaw:", rawResponse);
    // Try to extract JSON if wrapped in text
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        let extracted = JSON.parse(jsonMatch[0]);
        console.log("✅ Extracted JSON from wrapped response");
        // Re-run normalization on extracted JSON
        if (extracted.header_metadata) {
          extracted = {
            supplier: extracted.header_metadata.supplier_name || '',
            billNo: extracted.header_metadata.invoice_number || '',
            date: extracted.header_metadata.invoice_date || '',
            items: extracted.line_items || []
          };
        }
        return extracted;
      } catch (_) {
        console.error("❌ Could not extract JSON from response");
      }
    }
    throw new Error(`Invalid JSON response from Gemini: ${rawResponse.substring(0, 200)}`);
  }
}

function prepareCanvasForGemini(canvas: HTMLCanvasElement): { base64Data: string; mimeType: string } {
  const maxDimension = 1400; // Good balance: accuracy + speed
  const largestDimension = Math.max(canvas.width, canvas.height);
  const scale = largestDimension > maxDimension ? maxDimension / largestDimension : 1;
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(canvas.width * scale));
  output.height = Math.max(1, Math.round(canvas.height * scale));

  const context = output.getContext('2d')!;
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(canvas, 0, 0, output.width, output.height);

  const dataUrl = output.toDataURL('image/jpeg', 0.75); // Better quality for text extraction
  return { base64Data: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
}

export async function performGeminiVerbatimOcrOnCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (message: string) => void
): Promise<string> {
  if (!canvas) throw new Error("Canvas element unavailable for OCR");

  onProgress?.("Preparing image...");
  const { base64Data, mimeType } = prepareCanvasForGemini(canvas);

  onProgress?.("Extracting text...");
  const text = await callGeminiWithRotation({
    contents: [{
      role: 'user',
      parts: [
        {
          text: 'Transcribe all visible text from this invoice image exactly as it appears. Preserve line breaks and table rows where possible. Return only the extracted text, without commentary or Markdown.'
        },
        { inlineData: { mimeType, data: base64Data } }
      ]
    }],
    generationConfig: {
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  });

  onProgress?.("Text extracted.");
  return text;
}

export function preprocessCanvasForOcr(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const processedCanvas = document.createElement('canvas');
  processedCanvas.width = width;
  processedCanvas.height = height;
  const ctx = processedCanvas.getContext('2d')!;

  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let gray = 0.299 * r + 0.587 * g + 0.114 * b;

    const contrast = 1.4;
    const brightness = 15;
    gray = ((gray - 128) * contrast) + 128 + brightness;
    gray = Math.max(0, Math.min(255, gray));

    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);
  return processedCanvas;
}

export async function performTesseractOcrOnCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: { status: string; progress: number }) => void
): Promise<string> {
  if (!canvas) throw new Error("Canvas element unavailable for OCR");

  onProgress?.({ status: 'Preprocessing image for better OCR...', progress: 0 });

  const processedCanvas = preprocessCanvasForOcr(canvas);

  onProgress?.({ status: 'Loading Tesseract OCR engine...', progress: 0.05 });

  const result = await Tesseract.recognize(
    processedCanvas,
    'eng',
    {
      tessedit_pageseg_mode: 6,
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          onProgress?.({
            status: `Scanning text... ${Math.round(m.progress * 100)}%`,
            progress: 0.05 + (m.progress * 0.9)
          });
        } else if (m.status === 'loading language traineddata') {
          onProgress?.({ status: 'Loading OCR language data...', progress: 0.02 });
        } else {
          onProgress?.({ status: m.status, progress: 0.05 });
        }
      }
    }
  );

  onProgress?.({ status: 'Parsing and structuring data...', progress: 0.98 });

  return result.data.text;
}
