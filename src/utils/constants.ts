export const ERP_COLUMNS = [
  "SUPPLIER", "BILL NO.", "DATE", "COMPANY", "CODE", "BARCODE", 
  "ITEM NAME", "PACK", "BATCH", "EXPIRY", "QTY", "F.QTY", 
  "HALFP", "FTRATE", "SRATE", "MRP", "DIS", "EXCISE", 
  "VAT", "ADNLVAT", "AMOUNT", "LOCALCENT", "SCM1", "SCM2", 
  "SCMPER", "HSNCODE", "CGST", "SGST", "IGST", "PSRLNO", 
  "TCSPER", "TCSAMT", "ALTERCODE", "PONUMBER"
];

export const ERP_COLUMN_MIN_WIDTH: Record<string, number> = {
  SUPPLIER: 168,
  "BILL NO.": 110,
  DATE: 100,
  COMPANY: 120,
  CODE: 88,
  BARCODE: 100,
  "ITEM NAME": 240,
  PACK: 72,
  BATCH: 120,
  EXPIRY: 80,
  QTY: 56,
  "F.QTY": 64,
  HALFP: 64,
  FTRATE: 80,
  SRATE: 80,
  MRP: 72,
  DIS: 56,
  EXCISE: 64,
  VAT: 56,
  ADNLVAT: 72,
  AMOUNT: 88,
  LOCALCENT: 80,
  SCM1: 64,
  SCM2: 64,
  SCMPER: 72,
  HSNCODE: 100,
  CGST: 64,
  SGST: 64,
  IGST: 64,
  PSRLNO: 64,
  TCSPER: 64,
  TCSAMT: 72,
  ALTERCODE: 88,
  PONUMBER: 88
};

export const HEADER_KEYWORDS = [
  "ITEM NAME", "ITEM", "PRODUCT", "DESCRIPTION", "PARTICULARS", "DRUG NAME", 
  "MEDICINE", "NAME OF ITEM", "BRAND", "QTY", "QUANTITY", "BATCH", "EXPIRY", 
  "PACK", "PACKING", "MRP", "FTRATE", "F RATE", "RATE", "PRATE", "PRICE", "PTR", "AMOUNT", "HSN", "CGST", "SGST", "IGST"
];

export const HEADER_SYNONYMS: Record<string, string[]> = {
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
  "FTRATE": ["FTRATE", "F RATE", "F.RATE", "F-RATE", "F_RATE", "RATE", "PRATE", "P RATE", "P.RATE", "PRICE"],
  "SRATE": ["SRATE", "S.RATE", "S RATE"],
  "MRP": ["MRP", "M.R.P.", "M.R.P", "MRP (RS)", "MAX RETAIL PRICE", "R.P.", "M.R.P (RS)"],
  "DIS": ["DIS", "DISC", "DISC%", "DIS %", "DISCOUNT", "LESS", "DISC AMT", "DISC.", "DIS%"],
  "AMOUNT": ["AMOUNT", "NET AMOUNT", "TOTAL", "TOTAL AMOUNT", "VALUE", "AMT", "NET AMT", "TAXABLE VALUE", "TOTAL AMT"],
  "HSNCODE": ["HSNCODE", "HSN", "HSN/SAC", "HSN CODE", "SAC CODE", "HSN/SAC CODE", "HSN CODE."],
  "CGST": ["CGST", "CGST%", "CGST RATE", "CGST AMT", "C-GST", "CGST %"],
  "SGST": ["SGST", "SGST%", "SGST RATE", "SGST AMT", "S-GST", "UTGST", "SGST %"],
  "IGST": ["IGST", "IGST%", "IGST RATE", "IGST AMT", "I-GST", "IGST %"],
  "COMPANY": ["COMPANY", "MFG", "MFR", "MANUFACTURER", "BRAND", "CO.", "MAKER", "MFG CO", "MFR NAME", "MFG."]
};

/** Set true to show the Raw PDF Text Data tab again. */
export const SHOW_RAW_PDF_TEXT_TAB = false;

/** Blank cells in these columns become 0. Text fields (name, date, barcode, etc.) stay empty. */
export const ZERO_FILL_COLUMNS = [
  "QTY", "F.QTY", "HALFP", "FTRATE", "SRATE", "MRP", "DIS", "EXCISE",
  "VAT", "ADNLVAT", "AMOUNT", "SCM1", "SCM2", "SCMPER",
  "CGST", "SGST", "IGST", "PSRLNO", "TCSPER", "TCSAMT", "ALTERCODE", "PONUMBER"
];

export type AppThemeId = 'paper' | 'yellow' | 'mint' | 'sky' | 'peach' | 'ocean' | 'coral' | 'slate';

export const THEME_OPTIONS: { id: AppThemeId; label: string; swatch: string; hasShapes: boolean }[] = [
  { id: 'paper', label: 'Paper', swatch: 'linear-gradient(135deg, #f4e6e0, #e8f0f4, #f3e6d4)', hasShapes: false },
  { id: 'yellow', label: 'Sunshine', swatch: '#f4c400', hasShapes: true },
  { id: 'mint', label: 'Mint', swatch: '#7dcea0', hasShapes: true },
  { id: 'sky', label: 'Sky', swatch: '#5dade2', hasShapes: true },
  { id: 'peach', label: 'Peach', swatch: '#f5b48a', hasShapes: true },
  { id: 'ocean', label: 'Ocean', swatch: '#1abc9c', hasShapes: true },
  { id: 'coral', label: 'Coral', swatch: '#f1948a', hasShapes: true },
  { id: 'slate', label: 'Slate', swatch: '#94a3b8', hasShapes: true },
];
