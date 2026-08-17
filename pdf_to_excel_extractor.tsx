import React, { useState, useEffect, useRef } from 'react';
import {
  FileText, Upload, Download, Sparkles, RefreshCw, Trash2, Plus, 
  Settings, CheckCircle, AlertCircle, Eye, Table as TableIcon,
  ChevronRight, ChevronLeft, Search, ShieldCheck, 
  Pill, Zap, Filter, Edit3, ArrowRightLeft, Layers, CheckSquare, Scan
} from 'lucide-react';

const ERP_COLUMNS = [
  "SUPPLIER", "BILL NO.", "DATE", "COMPANY", "CODE", "BARCODE", 
  "ITEM NAME", "PACK", "BATCH", "EXPIRY", "QTY", "F.QTY", 
  "HALFP", "FTRATE", "SRATE", "MRP", "DIS", "EXCISE", 
  "VAT", "ADNLVAT", "AMOUNT", "LOCALCENT", "SCM1", "SCM2", 
  "SCMPER", "HSNCODE", "CGST", "SGST", "IGST", "PSRLNO", 
  "TCSPER", "TCSAMT", "ALTERCODE", "PONUMBER"
];

const HEADER_KEYWORDS = [
  "ITEM NAME", "ITEM", "PRODUCT", "DESCRIPTION", "PARTICULARS", "DRUG NAME", 
  "MEDICINE", "NAME OF ITEM", "BRAND", "QTY", "QUANTITY", "BATCH", "EXPIRY", 
  "PACK", "PACKING", "MRP", "RATE", "PTR", "AMOUNT", "HSN", "CGST", "SGST", "IGST"
];

const BLACKLISTED_NON_PRODUCT_PATTERNS = [
  /INVOICE\s*NO/i, /ORDER\s*NO/i, /L\.?R\.?\s*NO/i, /EWAY\s*BILL/i, /WAY\s*BILL/i,
  /TRANSPORT/i, /VEHICLE/i, /DUE\s*DATE/i, /DETAILS\s*OF\s*RECEIVER/i, /BILLED\s*TO/i,
  /TERMS\s*&\s*CONDITIONS/i, /GOODS\s*ONCE\s*SOLD/i, /ROUND\s*OFF/i, /ROUNDOFF/i,
  /DISCOUNT\s*\d/i, /MEPIKING/i, /BANK\s*DETAILS/i, /AMOUNT\s*IN\s*WORDS/i,
  /SUB\s*TOTAL/i, /SUBTOTAL/i, /GRAND\s*TOTAL/i, /TAXABLE\s*VALUE/i, /WEIGHT/i,
  /CASES/i, /EXCHANGED/i, /PAGE\s*\d/i, /FOR\s+[A-Z\s]+/i, /AUTHORIZED\s*SIGNATORY/i
];

const HEADER_SYNONYMS = {
  "ITEM NAME": [
    "ITEM", "ITEM NAME", "PRODUCT", "PRODUCT NAME", "PARTICULARS", 
    "DESCRIPTION", "DESCRIPTION OF GOODS", "DRUG NAME", "MEDICINE", 
    "MEDICINE NAME", "NAME OF ITEM", "NAME OF PRODUCT", "ITEMS", 
    "PRODUCT DESCRIPTION", "PARTICULAR", "BRAND", "BRAND NAME", "ITEM DESCRIPTION"
  ],
  "PACK": ["PACK", "PACKING", "PKG", "PACK SIZE", "UNIT", "BOX", "STRIP", "UOM", "PACKING SIZE"],
  "BATCH": ["BATCH", "BATCH NO", "BATCH NO.", "BATCH/LOT", "B.NO", "B.NO.", "LOT", "LOT NO", "LOT/BATCH", "BTCH"],
  "EXPIRY": ["EXPIRY", "EXP", "EXP.", "EXP DATE", "EXP.DATE", "MFG/EXP", "E.DATE", "EXP DATE/MFG", "EXP DT", "EXP-DATE", "EXPDATE"],
  "QTY": ["QTY", "QUANTITY", "QTY.", "NOS", "QNTY", "BILLED QTY", "BILL QTY", "P.QTY"],
  "F.QTY": ["F.QTY", "FREE QTY", "FREE", "FREE NOS", "BONUS", "SCHEME QTY", "F QTY", "FREE QTY."],
  "SRATE": ["SRATE", "S.RATE", "RATE", "PTR", "P.RATE", "PUR RATE", "PURCHASE RATE", "UNIT PRICE", "RATE (RS)", "PRICE", "NET RATE", "S RATE"],
  "MRP": ["MRP", "M.R.P.", "M.R.P", "MRP (RS)", "MAX RETAIL PRICE", "R.P.", "M.R.P (RS)"],
  "DIS": ["DIS", "DISC", "DISC%", "DIS %", "DISCOUNT", "LESS", "DISC AMT", "DISC.", "DIS%"],
  "AMOUNT": ["AMOUNT", "NET AMOUNT", "TOTAL", "TOTAL AMOUNT", "VALUE", "AMT", "NET AMT", "TAXABLE VALUE", "TOTAL AMT"],
  "HSNCODE": ["HSNCODE", "HSN", "HSN/SAC", "HSN CODE", "SAC CODE", "HSN/SAC CODE", "HSN CODE."],
  "CGST": ["CGST", "CGST%", "CGST RATE", "CGST AMT", "C-GST", "CGST %"],
  "SGST": ["SGST", "SGST%", "SGST RATE", "SGST AMT", "S-GST", "UTGST", "SGST %"],
  "IGST": ["IGST", "IGST%", "IGST RATE", "IGST AMT", "I-GST", "IGST %"],
  "COMPANY": ["COMPANY", "MFG", "MFR", "MANUFACTURER", "BRAND", "CO.", "MAKER", "MFG CO", "MFR NAME", "MFG."]
};

const INITIAL_SAMPLE_DATA = [
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
    "ITEM NAME": "XYZAL5 TAB", "PACK": "1*10", "BATCH": "TE2501289", "EXPIRY": "4/27", "QTY": "2", "F.QTY": "0", "HALFP": "", "FTRATE": "",
    "SRATE": "155.90", "MRP": "204.60", "DIS": "0", "EXCISE": "", "VAT": "", "ADNLVAT": "", "AMOUNT": "311.80", "LOCALCENT": "", "SCM1": "", "SCM2": "",
    "SCMPER": "", "HSNCODE": "30049099", "CGST": "6.00", "SGST": "6.00", "IGST": "0", "PSRLNO": "4", "TCSPER": "", "TCSAMT": "", "ALTERCODE": "", "PONUMBER": ""
  }
];

function cleanAndPurifyProductName(rawName, rowRef = null) {
  if (!rawName) return "";
  let str = rawName.toString().trim();

  // 1. Strip leading row numbers
  str = str.replace(/^(?:\[?\d+\]?[\.\s\-]+|S\.?NO\.?\s*\d+[\.\s\-]*)/i, '');

  // 2. Strip repeated header titles
  HEADER_KEYWORDS.forEach(kw => {
    const reg = new RegExp(`\\b${kw}\\b`, 'gi');
    str = str.replace(reg, '');
  });

  // 3. Strip GST tax tags
  str = str.replace(/(?:GST|CGST|SGST|IGST)?\s*@?\s*\d+(?:\.\d+)?%/gi, '');

  // 4. Extract & isolate HSN code if embedded
  const hsnMatch = str.match(/\b(30\d{6}|84\d{6}|90\d{6}|\d{8})\b/);
  if (hsnMatch) {
    if (rowRef && !rowRef["HSNCODE"]) rowRef["HSNCODE"] = hsnMatch[1];
    str = str.replace(hsnMatch[0], '');
  }

  // 5. Extract & isolate Expiry date if embedded
  const expMatch = str.match(/\b(0[1-9]|1[0-2])\/(\d{2}|\d{4})\b/);
  if (expMatch) {
    if (rowRef && !rowRef["EXPIRY"]) rowRef["EXPIRY"] = expMatch[0];
    str = str.replace(expMatch[0], '');
  }

  // 6. Extract & isolate Pack size if embedded
  const packMatch = str.match(/\b(\d+\s*[\*xX]\s*\d+|\d+[`']?[sS])\b/);
  if (packMatch) {
    if (rowRef && !rowRef["PACK"]) rowRef["PACK"] = packMatch[0];
    str = str.replace(packMatch[0], '');
  }

  // 7. Extract & isolate Batch number if embedded
  const batchMatch = str.match(/\b([A-Z]{2,4}\d{5,8}[A-Z]?|[A-Z]\d{6,8})\b/);
  if (batchMatch) {
    if (rowRef && !rowRef["BATCH"]) rowRef["BATCH"] = batchMatch[0];
    str = str.replace(batchMatch[0], '');
  }

  // 8. Strip standalone decimal numbers (rates/amounts)
  str = str.replace(/\b\d+\.\d{2}\b/g, '');

  // 9. Clean up extra whitespace & stray punctuation
  str = str.replace(/\s+/g, ' ').trim();
  str = str.replace(/^[\.\,\-\/\:]+|[\.\,\-\/\:]+$/g, '').trim();

  return str;
}

const performGeminiOcrOnCanvas = async (canvas) => {
  if (!canvas) throw new Error("Canvas element unavailable for OCR");
  
  const dataUrl = canvas.toDataURL('image/png');
  const base64Data = dataUrl.split(',')[1];

  const apiKey = ""; // Provided automatically by runtime
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const userPrompt = "Analyze this pharma invoice image. Extract header details (supplier name, bill number, date) and all table product line items into structured JSON. For each item, extract item name, pack size, batch number, expiry date, quantity, free quantity, rate (PTR/SRATE), MRP, discount, total amount, HSN code, CGST, SGST, IGST, and manufacturer/company name.";

  const payload = {
    contents: [{
      role: "user",
      parts: [
        { text: userPrompt },
        {
          inlineData: {
            mimeType: "image/png",
            data: base64Data
          }
        }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          supplier: { type: "STRING" },
          billNo: { type: "STRING" },
          date: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                "ITEM NAME": { type: "STRING" },
                "PACK": { type: "STRING" },
                "BATCH": { type: "STRING" },
                "EXPIRY": { type: "STRING" },
                "QTY": { type: "STRING" },
                "F.QTY": { type: "STRING" },
                "SRATE": { type: "STRING" },
                "MRP": { type: "STRING" },
                "DIS": { type: "STRING" },
                "AMOUNT": { type: "STRING" },
                "HSNCODE": { type: "STRING" },
                "CGST": { type: "STRING" },
                "SGST": { type: "STRING" },
                "IGST": { type: "STRING" },
                "COMPANY": { type: "STRING" }
              }
            }
          }
        }
      }
    }
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Vision API Error (${response.status}): ${errText}`);
  }

  const result = await response.json();
  const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!jsonText) {
    throw new Error("No data returned from Gemini AI Vision OCR");
  }

  return JSON.parse(jsonText);
};

export default function App() {
  const [tableData, setTableData] = useState(INITIAL_SAMPLE_DATA);
  const [docHeaderInfo, setDocHeaderInfo] = useState({ supplier: 'HEALING PHARMACY CHD', billNo: 'MK010343', date: '29-07-2026' });
  const [activeTab, setActiveTab] = useState('studio'); // studio | raw
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Ready for processing');
  const [isDragging, setIsDragging] = useState(false);
  
  // Customization Toggles
  const [autoFillHeaderInfo, setAutoFillHeaderInfo] = useState(true);

  // PDF Document State
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [processAllPages, setProcessAllPages] = useState(false);
  const [isScannedPdf, setIsScannedPdf] = useState(false);
  
  // Raw text view inspection state
  const [rawTextLines, setRawTextLines] = useState([]);
  const [rawSearchTerm, setRawSearchTerm] = useState('');

  // Cutoff boundaries for table extraction
  const [tableTopCutoff, setTableTopCutoff] = useState(15);
  const [tableBottomCutoff, setTableBottomCutoff] = useState(85);
  const [autoDetectBounds, setAutoDetectBounds] = useState(true);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load required external libraries dynamically (PDF.js and SheetJS XLSX)
  useEffect(() => {
    const loadPdfJs = () => {
      if (!window.pdfjsLib) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.async = true;
        script.onload = () => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            setStatusMsg('PDF & Data engines loaded and ready');
          }
        };
        document.head.appendChild(script);
      }
    };

    const loadXlsx = () => {
      if (!window.XLSX) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        script.async = true;
        document.head.appendChild(script);
      }
    };

    loadPdfJs();
    loadXlsx();
  }, []);

  const handleRunAiOcr = async (targetPages = 'current') => {
    if (!pdfDoc) {
      setStatusMsg("Please upload a PDF invoice first.");
      return;
    }

    setIsProcessing(true);
    setStatusMsg("Initializing Gemini AI Vision OCR...");

    try {
      let combinedItems = [];
      let finalHeader = { supplier: docHeaderInfo.supplier, billNo: docHeaderInfo.billNo, date: docHeaderInfo.date };

      const pagesToProcess = targetPages === 'all' 
        ? Array.from({ length: totalPages }, (_, i) => i + 1)
        : [currentPage];

      for (const pageNum of pagesToProcess) {
        setStatusMsg(`Rendering Page ${pageNum} for AI Vision OCR...`);
        
        const page = await pdfDoc.getPage(pageNum);
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        const viewport = page.getViewport({ scale: 2.0 });
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;

        setStatusMsg(`Analyzing Page ${pageNum} with Gemini AI Vision...`);
        const ocrData = await performGeminiOcrOnCanvas(tempCanvas);

        if (ocrData) {
          if (ocrData.supplier && !finalHeader.supplier) finalHeader.supplier = ocrData.supplier;
          if (ocrData.billNo && !finalHeader.billNo) finalHeader.billNo = ocrData.billNo;
          if (ocrData.date && !finalHeader.date) finalHeader.date = ocrData.date;

          if (Array.isArray(ocrData.items)) {
            ocrData.items.forEach(item => {
              const fullRow = {};
              ERP_COLUMNS.forEach(col => fullRow[col] = "");

              Object.keys(item).forEach(key => {
                const upperKey = key.toUpperCase();
                if (ERP_COLUMNS.includes(upperKey)) {
                  fullRow[upperKey] = String(item[key] || "");
                }
              });

              fullRow["ITEM NAME"] = cleanAndPurifyProductName(fullRow["ITEM NAME"] || item["ITEM NAME"], fullRow);

              if (autoFillHeaderInfo) {
                fullRow["SUPPLIER"] = finalHeader.supplier || docHeaderInfo.supplier;
                fullRow["BILL NO."] = finalHeader.billNo || docHeaderInfo.billNo;
                fullRow["DATE"] = finalHeader.date || docHeaderInfo.date;
              }

              if (fullRow["ITEM NAME"]) {
                combinedItems.push(fullRow);
              }
            });
          }
        }
      }

      combinedItems.forEach((row, idx) => {
        row["PSRLNO"] = (idx + 1).toString();
      });

      if (combinedItems.length > 0) {
        setTableData(targetPages === 'all' ? combinedItems : [...tableData, ...combinedItems]);
        setDocHeaderInfo(finalHeader);
        setIsScannedPdf(false);
        setStatusMsg(`Extracted ${combinedItems.length} items using Gemini AI Vision OCR!`);
      } else {
        setStatusMsg("AI OCR complete, but no items detected. Check image clarity.");
      }
    } catch (err) {
      console.error("AI OCR Error:", err);
      setStatusMsg("AI OCR Error: " + (err.message || "Failed to process image"));
    } finally {
      setIsProcessing(false);
    }
  };

  const extractDataFromPage = async (doc, pageNum) => {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    const pageHeight = viewport.height;
    const pageWidth = viewport.width;

    if (!textContent.items || textContent.items.length === 0) {
      return null;
    }

    const items = textContent.items.map(item => {
      const tx = item.transform;
      const x = tx[4];
      const y = pageHeight - tx[5];
      return {
        text: item.str,
        x: Math.round(x),
        y: Math.round(y),
        width: item.width || (item.str.length * 6),
        height: item.height || 10
      };
    }).filter(item => item.text.trim().length > 0);

    if (items.length === 0) return null;

    // Group items into lines by Y-coordinate
    const lineMap = new Map();
    items.forEach(item => {
      let foundLineY = null;
      for (const yKey of lineMap.keys()) {
        if (Math.abs(yKey - item.y) <= 4) {
          foundLineY = yKey;
          break;
        }
      }
      if (foundLineY !== null) {
        lineMap.get(foundLineY).push(item);
      } else {
        lineMap.set(item.y, [item]);
      }
    });

    const sortedYKeys = Array.from(lineMap.keys()).sort((a, b) => a - b);
    const sortedLines = sortedYKeys.map(y => {
      const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
      const fullText = lineItems.map(i => i.text.trim()).join(' ');
      return { y, items: lineItems, text: fullText };
    });

    // Save for Raw Text Inspection Tab
    setRawTextLines(sortedLines);

    // Detect Table Header Line
    let tableHeaderIndex = -1;
    let detectedTopY = 15;
    let detectedBottomY = 85;

    for (let i = 0; i < sortedLines.length; i++) {
      const lineText = sortedLines[i].text.toUpperCase();
      const matchesHeaderKeywords = HEADER_KEYWORDS.filter(kw => lineText.includes(kw));

      if (matchesHeaderKeywords.length >= 2) {
        tableHeaderIndex = i;
        detectedTopY = Math.max(5, Math.floor((sortedLines[i].y / pageHeight) * 100) - 1);
        break;
      }
    }

    for (let i = tableHeaderIndex + 1; i < sortedLines.length; i++) {
      const lineText = sortedLines[i].text.toUpperCase();
      if (
        lineText.includes('GRAND TOTAL') || lineText.includes('SUB TOTAL') || 
        lineText.includes('SUBTOTAL') || lineText.includes('TERMS &') || 
        lineText.includes('FOR ') || lineText.includes('BANK DETAILS') || 
        lineText.includes('AMOUNT IN WORDS') || lineText.includes('ROUNDOFF')
      ) {
        detectedBottomY = Math.min(95, Math.ceil((sortedLines[i].y / pageHeight) * 100));
        break;
      }
    }

    const topPixelLimit = (autoDetectBounds ? detectedTopY : tableTopCutoff) / 100 * pageHeight;
    const bottomPixelLimit = (autoDetectBounds ? detectedBottomY : tableBottomCutoff) / 100 * pageHeight;

    let detectedSupplier = docHeaderInfo.supplier;
    let detectedBillNo = docHeaderInfo.billNo;
    let detectedDate = docHeaderInfo.date;

    sortedLines.forEach(line => {
      const t = line.text.toUpperCase();
      if (t.includes('BILL') || t.includes('INV') || t.includes('INVOICE')) {
        const match = line.text.match(/(?:BILL|INV|INVOICE)\s*(?:NO|NUMBER)?[:.-]?\s*([A-Z0-9/-]+)/i);
        if (match && match[1]) detectedBillNo = match[1];
      }
      if (t.includes('DATE') || t.includes('DATED')) {
        const match = line.text.match(/\d{2}[-/\.]\d{2}[-/\.]\d{2,4}/);
        if (match) detectedDate = match[0];
      }
      if ((t.includes('PHARMA') || t.includes('DISTRIBUTOR') || t.includes('AGENCIES') || t.includes('LIMITED')) && !t.includes('BILL')) {
        if (line.text.length > 5) detectedSupplier = line.text;
      }
    });

    let detectedColumns = [];
    if (tableHeaderIndex !== -1) {
      const headerLine = sortedLines[tableHeaderIndex];
      const sortedHeaderItems = [...headerLine.items].sort((a, b) => a.x - b.x);

      const rawHeaderList = [];
      sortedHeaderItems.forEach((hItem) => {
        const textUpper = hItem.text.trim().toUpperCase();
        let matchedErpCol = "ITEM NAME";

        for (const [erpCol, synonyms] of Object.entries(HEADER_SYNONYMS)) {
          if (synonyms.some(s => textUpper === s || textUpper.includes(s))) {
            matchedErpCol = erpCol;
            break;
          }
        }

        rawHeaderList.push({
          x: hItem.x,
          width: hItem.width,
          rawText: hItem.text.trim(),
          erpCol: matchedErpCol
        });
      });

      detectedColumns = rawHeaderList.map((col, idx) => {
        const prevCol = rawHeaderList[idx - 1];
        const nextCol = rawHeaderList[idx + 1];

        let xStart = prevCol ? prevCol.x + (col.x - prevCol.x) / 2 : 0;
        let xEnd = nextCol ? col.x + (nextCol.x - col.x) / 2 : pageWidth;

        return { xStart, xEnd, xPos: col.x, rawHeader: col.rawText, erpCol: col.erpCol };
      });
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

    let tableDataLines = sortedLines.filter((line, idx) => {
      if (idx === tableHeaderIndex) return false;
      if (line.y < topPixelLimit || line.y > bottomPixelLimit) return false;
      const t = line.text;
      for (const pattern of BLACKLISTED_NON_PRODUCT_PATTERNS) {
        if (pattern.test(t)) return false;
      }
      return true;
    });

    let extractedRows = [];
    let lastMainRow = null;

    tableDataLines.forEach((line) => {
      const rowObj = {};
      ERP_COLUMNS.forEach(c => rowObj[c] = "");

      const colTokenMap = {};
      detectedColumns.forEach(c => colTokenMap[c.erpCol] = []);

      line.items.forEach(item => {
        for (const colDef of detectedColumns) {
          if (item.x >= colDef.xStart && item.x < colDef.xEnd) {
            colTokenMap[colDef.erpCol].push(item.text.trim());
            break;
          }
        }
      });

      for (const [colName, tokens] of Object.entries(colTokenMap)) {
        if (tokens.length > 0) {
          rowObj[colName] = tokens.join(' ').trim();
        }
      }

      const cleanedItemName = cleanAndPurifyProductName(rowObj["ITEM NAME"] || line.text, rowObj);
      const isNewProductRow = cleanedItemName && cleanedItemName.length > 1;

      if (isNewProductRow) {
        rowObj["ITEM NAME"] = cleanedItemName;
        if (autoFillHeaderInfo) {
          rowObj["SUPPLIER"] = detectedSupplier;
          rowObj["BILL NO."] = detectedBillNo;
          rowObj["DATE"] = detectedDate;
        }
        extractedRows.push(rowObj);
        lastMainRow = rowObj;
      } else if (lastMainRow) {
        ERP_COLUMNS.forEach(col => {
          if (rowObj[col] && rowObj[col].length > 0) {
            if (!lastMainRow[col]) {
              lastMainRow[col] = rowObj[col];
            } else if (col === "ITEM NAME" && cleanedItemName) {
              lastMainRow["ITEM NAME"] = cleanAndPurifyProductName(`${lastMainRow["ITEM NAME"]} ${cleanedItemName}`, lastMainRow);
            }
          }
        });
      }
    });

    return { rows: extractedRows, supplier: detectedSupplier, billNo: detectedBillNo, date: detectedDate, lines: sortedLines };
  };

  const extractAllPagesData = async (doc) => {
    let combinedRows = [];
    
    for (let p = 1; p <= doc.numPages; p++) {
      setStatusMsg(`Extracting data from Page ${p} of ${doc.numPages}...`);
      const pageResult = await extractDataFromPage(doc, p);
      if (pageResult) {
        combinedRows = [...combinedRows, ...pageResult.rows];
      }
    }

    combinedRows.forEach((r, idx) => {
      r["PSRLNO"] = (idx + 1).toString();
    });

    if (combinedRows.length > 0) {
      setTableData(combinedRows);
      setStatusMsg(`Extracted ${combinedRows.length} product rows from all ${doc.numPages} pages!`);
    } else {
      setIsScannedPdf(true);
      setStatusMsg("Scanned PDF detected. Running Gemini AI Vision OCR automatically...");
      await handleRunAiOcr('all');
    }
  };

  const processPdfExtraction = async (doc, pageNum) => {
    const pageResult = await extractDataFromPage(doc, pageNum);
    if (!pageResult) {
      setIsScannedPdf(true);
      setStatusMsg("Scanned PDF detected. Running Gemini AI Vision OCR automatically...");
      await handleRunAiOcr('current');
      return;
    }

    setIsScannedPdf(false);
    setDocHeaderInfo({ supplier: pageResult.supplier, billNo: pageResult.billNo, date: pageResult.date });

    if (pageResult.rows.length > 0) {
      setTableData(pageResult.rows);
      setStatusMsg(`Successfully extracted ${pageResult.rows.length} product rows from Page ${pageNum}!`);
    } else {
      setIsScannedPdf(true);
      setStatusMsg("No text found. Running Gemini AI Vision OCR...");
      await handleRunAiOcr('current');
    }
  };

  const renderPdfPage = async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      const page = await pdfDoc.getPage(pageNum);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const viewport = page.getViewport({ scale: 1.2 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Draw Y-Cutoff Bounds Overlay
      const topY = (tableTopCutoff / 100) * canvas.height;
      const bottomY = (tableBottomCutoff / 100) * canvas.height;

      ctx.strokeStyle = '#10B981'; // Green Top Cutoff Line
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, topY);
      ctx.lineTo(canvas.width, topY);
      ctx.stroke();

      ctx.strokeStyle = '#EF4444'; // Red Bottom Cutoff Line
      ctx.beginPath();
      ctx.moveTo(0, bottomY);
      ctx.lineTo(canvas.width, bottomY);
      ctx.stroke();

      ctx.setLineDash([]);
    } catch (err) {
      console.error("Canvas render error:", err);
    }
  };

  useEffect(() => {
    if (pdfDoc) {
      renderPdfPage(currentPage);
      if (!processAllPages) {
        processPdfExtraction(pdfDoc, currentPage);
      }
    }
  }, [pdfDoc, currentPage, tableTopCutoff, tableBottomCutoff]);

  const processFile = async (file) => {
    if (!file) return;

    setIsProcessing(true);
    setStatusMsg(`Loading "${file.name}"...`);
    setPdfFile(file);
    setIsScannedPdf(false);

    // Reset previous table data & header info on new upload
    setTableData([]);
    setDocHeaderInfo({ supplier: '', billNo: '', date: '' });

    // Handle Image file upload (PNG, JPG, WEBP, etc.)
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
            ctx.drawImage(img, 0, 0);
          }
          setStatusMsg("Image bill loaded. Click 'AI Vision OCR' to parse data.");
          setIsProcessing(false);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
      return;
    }

    // Handle PDF file upload
    if (!window.pdfjsLib) {
      setStatusMsg("PDF parsing engine is still loading... Please wait a few seconds and re-select your file.");
      setIsProcessing(false);
      return;
    }

    try {
      const fileArrayBuffer = await file.arrayBuffer();
      const loadedPdf = await window.pdfjsLib.getDocument({ data: fileArrayBuffer }).promise;
      
      setPdfDoc(loadedPdf);
      setTotalPages(loadedPdf.numPages);
      setCurrentPage(1);

      if (processAllPages) {
        await extractAllPagesData(loadedPdf);
      } else {
        await processPdfExtraction(loadedPdf, 1);
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("Error reading PDF file: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      processFile(file);
      if (event.target) event.target.value = '';
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleCleanAndFixData = () => {
    setIsProcessing(true);
    setStatusMsg("Isolating product titles and purging junk values...");
    
    setTimeout(() => {
      const cleaned = tableData
        .filter(row => {
          const name = row["ITEM NAME"] || "";
          for (const pattern of BLACKLISTED_NON_PRODUCT_PATTERNS) {
            if (pattern.test(name)) return false;
          }
          return name.length > 1;
        })
        .map((row, idx) => {
          const updatedRow = { ...row };
          updatedRow["ITEM NAME"] = cleanAndPurifyProductName(updatedRow["ITEM NAME"], updatedRow);

          if (autoFillHeaderInfo) {
            updatedRow["SUPPLIER"] = docHeaderInfo.supplier;
            updatedRow["BILL NO."] = docHeaderInfo.billNo;
            updatedRow["DATE"] = docHeaderInfo.date;
            updatedRow["PSRLNO"] = (idx + 1).toString();
          }

          return updatedRow;
        });

      setTableData(cleaned);
      setIsProcessing(false);
      setStatusMsg("Product titles isolated cleanly and non-product rows purged!");
    }, 250);
  };

  const handleAddRow = () => {
    const emptyRow = {};
    ERP_COLUMNS.forEach(c => emptyRow[c] = "");
    if (autoFillHeaderInfo) {
      emptyRow["SUPPLIER"] = docHeaderInfo.supplier;
      emptyRow["BILL NO."] = docHeaderInfo.billNo;
      emptyRow["DATE"] = docHeaderInfo.date;
      emptyRow["PSRLNO"] = (tableData.length + 1).toString();
    }
    setTableData([...tableData, emptyRow]);
  };

  const handleDeleteRow = (index) => {
    const updated = tableData.filter((_, i) => i !== index);
    setTableData(updated);
  };

  const handleCellEdit = (rowIndex, colKey, value) => {
    const updated = [...tableData];
    updated[rowIndex][colKey] = value;
    setTableData(updated);
  };

  const handleExportExcel = () => {
    if (!window.XLSX) {
      setStatusMsg("Excel generator library loading. Please try again in 2 seconds.");
      return;
    }

    const worksheet = window.XLSX.utils.json_to_sheet(tableData, { header: ERP_COLUMNS });
    const colWidths = ERP_COLUMNS.map(col => ({
      wch: Math.max(col.length + 2, col === 'ITEM NAME' ? 36 : 12)
    }));
    worksheet['!cols'] = colWidths;

    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "Pharma ERP Clean");
    
    const fileName = `Clean_Invoice_${docHeaderInfo.billNo || 'Pharma'}.xlsx`;
    window.XLSX.writeFile(workbook, fileName);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      
      {/* Top Header Navbar */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-3">
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

        <div className="flex items-center space-x-3">
          <button
            onClick={() => handleRunAiOcr('all')}
            disabled={isProcessing || !pdfDoc}
            className="flex items-center space-x-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-3.5 py-2 rounded-lg text-sm font-semibold transition shadow-md shadow-purple-600/30 disabled:opacity-50"
            title="Run AI Vision OCR on all pages in the document"
          >
            <Zap className="w-4 h-4 text-yellow-300" />
            <span>AI Vision OCR (All Pages)</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-md shadow-indigo-600/30"
          >
            <Upload className="w-4 h-4" />
            <span>Upload Bill PDF / Image</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="application/pdf,image/*"
            className="hidden"
          />

          <button
            onClick={handleExportExcel}
            className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-md shadow-emerald-600/30"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel (.xlsx)</span>
          </button>
        </div>
      </header>

      {/* Subheader Status & Badges Bar */}
      <div className="bg-slate-800/60 border-b border-slate-700/50 px-6 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1.5 text-slate-300 bg-slate-900/60 px-3 py-1 rounded-md border border-slate-700">
            <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin text-indigo-400' : 'text-slate-400'}`} />
            <span>{statusMsg}</span>
          </span>
          <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 px-2.5 py-1 rounded-md font-medium">
            {tableData.length} Product Rows
          </span>
        </div>

        {/* Tab Navigation Controls */}
        <div className="flex items-center bg-slate-900/80 p-1 rounded-lg border border-slate-700">
          <button
            onClick={() => setActiveTab('studio')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
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

      {/* Main Studio Body */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'studio' ? (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            
            {/* Left Controls & PDF Preview Panel */}
            <div className="w-full lg:w-4/12 bg-slate-900 border-r border-slate-800 flex flex-col p-4 overflow-y-auto space-y-4">
              
              {isScannedPdf && (
                <div className="bg-purple-950/80 border border-purple-600/80 p-3.5 rounded-xl text-purple-200 text-xs flex flex-col space-y-2">
                  <div className="flex items-start space-x-2">
                    <Scan className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold block text-purple-300">Scanned / Image Invoice Detected</strong>
                      <span>Digital text layer missing. Gemini AI Vision OCR can extract all line items automatically across all pages.</span>
                    </div>
                  </div>
                  <div className="flex space-x-2 pt-1">
                    <button
                      onClick={() => handleRunAiOcr('current')}
                      disabled={isProcessing}
                      className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center space-x-1 transition disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                      <span>OCR (Current Page)</span>
                    </button>
                    <button
                      onClick={() => handleRunAiOcr('all')}
                      disabled={isProcessing}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center space-x-1 transition disabled:opacity-50"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-300" />
                      <span>OCR (All Pages)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Document Header Metadata Section */}
              <div className="bg-slate-800/80 border border-slate-700/80 p-3.5 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>Invoice Metadata</span>
                </h3>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <div>
                    <label className="text-slate-400 text-[11px]">Supplier Name</label>
                    <input
                      type="text"
                      value={docHeaderInfo.supplier}
                      onChange={(e) => setDocHeaderInfo({ ...docHeaderInfo, supplier: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 mt-0.5 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 text-[11px]">Bill No.</label>
                      <input
                        type="text"
                        value={docHeaderInfo.billNo}
                        onChange={(e) => setDocHeaderInfo({ ...docHeaderInfo, billNo: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 mt-0.5 focus:border-indigo-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 text-[11px]">Bill Date</label>
                      <input
                        type="text"
                        value={docHeaderInfo.date}
                        onChange={(e) => setDocHeaderInfo({ ...docHeaderInfo, date: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 mt-0.5 focus:border-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Table Bounds & Y-Cutoff Sliders */}
              <div className="bg-slate-800/80 border border-slate-700/80 p-3.5 rounded-xl space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                    <Filter className="w-4 h-4 text-emerald-400" />
                    <span>Table Y-Cutoff Boundaries</span>
                  </h3>
                  <label className="flex items-center space-x-1.5 text-[11px] text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDetectBounds}
                      onChange={(e) => setAutoDetectBounds(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Auto-Detect</span>
                  </label>
                </div>

                {!autoDetectBounds && (
                  <div className="space-y-3 pt-1">
                    <div>
                      <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                        <span>Top Cutoff (Table Header Start): {tableTopCutoff}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        value={tableTopCutoff}
                        onChange={(e) => setTableTopCutoff(Number(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                        <span>Bottom Cutoff (Footer/Totals Start): {tableBottomCutoff}%</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="100"
                        value={tableBottomCutoff}
                        onChange={(e) => setTableBottomCutoff(Number(e.target.value))}
                        className="w-full accent-rose-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Interactive PDF Page Visualizer */}
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`bg-slate-800/80 border ${isDragging ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-700/80'} p-3.5 rounded-xl flex flex-col flex-1 space-y-2 transition-all`}
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

            {/* Right Data Studio Grid Panel */}
            <div className="flex-1 bg-slate-950 flex flex-col overflow-hidden">
              
              {/* Toolbar Actions */}
              <div className="bg-slate-800/90 border-b border-slate-700/80 px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleCleanAndFixData}
                    className="flex items-center space-x-1.5 bg-indigo-600/90 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                    <span>Purify Product Titles & Remove Waste</span>
                  </button>
                  <button
                    onClick={handleAddRow}
                    className="flex items-center space-x-1 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Row</span>
                  </button>
                </div>

                <div className="flex items-center space-x-3 text-xs text-slate-400">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoFillHeaderInfo}
                      onChange={(e) => setAutoFillHeaderInfo(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Auto-Fill Header Meta into Rows</span>
                  </label>
                </div>
              </div>

              {/* Data Table */}
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-800 text-slate-300 sticky top-0 z-20 shadow">
                    <tr>
                      <th className="p-2 border-b border-r border-slate-700 w-10 text-center font-bold">#</th>
                      <th className="p-2 border-b border-r border-slate-700 w-12 text-center">Action</th>
                      {ERP_COLUMNS.map((col, i) => (
                        <th
                          key={i}
                          className={`p-2 border-b border-r border-slate-700 font-bold ${
                            col === 'ITEM NAME' ? 'bg-indigo-950/80 text-indigo-300 min-w-[220px]' : ''
                          }`}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {tableData.length > 0 ? (
                      tableData.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-slate-800/40 transition">
                          <td className="p-2 border-r border-slate-800 text-center text-slate-500 font-mono">
                            {rIdx + 1}
                          </td>
                          <td className="p-2 border-r border-slate-800 text-center">
                            <button
                              onClick={() => handleDeleteRow(rIdx)}
                              className="p-1 text-slate-500 hover:text-rose-400 rounded transition"
                              title="Delete Row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                          {ERP_COLUMNS.map((col, cIdx) => (
                            <td
                              key={cIdx}
                              className={`p-1 border-r border-slate-800/80 ${
                                col === 'ITEM NAME' ? 'bg-indigo-950/20 font-semibold text-indigo-200' : ''
                              }`}
                            >
                              <input
                                type="text"
                                value={row[col] || ''}
                                onChange={(e) => handleCellEdit(rIdx, col, e.target.value)}
                                className="w-full bg-transparent px-1.5 py-1 text-xs text-slate-200 border border-transparent hover:border-slate-700 focus:border-indigo-500 rounded outline-none transition"
                              />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={ERP_COLUMNS.length + 2} className="p-12 text-center text-slate-500">
                          <TableIcon className="w-10 h-10 mx-auto mb-2 opacity-40 text-slate-400" />
                          <p className="text-sm font-semibold">No Table Data Loaded</p>
                          <p className="text-xs text-slate-600 mt-1">Upload an invoice PDF to automatically parse 34-column ERP data</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        ) : (
          /* Raw PDF Text Inspection Tab */
          <div className="flex-1 bg-slate-950 p-6 overflow-y-auto flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-200">Raw PDF Text Line Inspection</h2>
                <p className="text-xs text-slate-400">View line-by-line text tokens extracted directly from PDF.js spatial coordinates</p>
              </div>
              <div className="relative w-64">
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

            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-auto p-4 font-mono text-xs space-y-1">
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