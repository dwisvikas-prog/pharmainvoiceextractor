import io
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pdfplumber

app = FastAPI(title='PDF Invoice Structured Extractor')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

COLUMNS = ['Section','Field','Value','S.N','HSN','Product Name','Pack','Qty','Free','Batch','Mfg','Exp','Old MRP','New MRP','Rate','Dis','IGST','Value','Amount','Notes']

SECTION_KEYWORDS = {
    'SUPPLIER': 'Supplier',
    'INVOICE': 'Invoice',
    'BUYER': 'Buyer',
    'ITEM': 'Item',
    'TAX SUMMARY': 'Tax Summary',
    'TAX': 'Tax Summary',
    'TOTALS': 'Totals',
    'TOTAL': 'Totals',
}

SECTION_FIELDS = {
    'Supplier': ['Name','Address','Phone','DL NO.','DL NO','FSSAI NO.','FSSAI NO','GSTIN','PAN NO.','PAN NO'],
    'Invoice': ['Document Type','Invoice No.','Invoice No','Invoice Date','Order No.','Order Date','Transport','Weight','E-Way Bill No.','L.R. No.','L.R. Date','Cases','Due Date','Delivery Att','Note'],
    'Buyer': ['Party Name','Address','Phone','GSTIN','Licence No.','Delivery Att'],
    'Totals': ['Total Items','Total Qty','TOTAL','DIS AMT.','IGST PAYBLE','Round off','ROUND OFF','Final Round-off','Grand Total'],
    'Tax Summary': ['CLASS','TOTAL','SCHEME','DISCOUNT','IGST'],
}

ITEM_CANON = {
    'S.N':'S.N','SNO':'S.N','SR. NO':'S.N','SRNO':'S.N',
    'HSN':'HSN','HSN/SAC':'HSN','HSN CODE':'HSN',
    'PRODUCT':'Product Name','PRODUCT NAME':'Product Name','ITEM':'Product Name','ITEM NAME':'Product Name','PARTICULARS':'Product Name','NAME OF ITEM':'Product Name','MEDICINE':'Product Name','NAME':'Product Name',
    'PACK':'Pack','PACKING':'Pack','PKG':'Pack',
    'QTY':'Qty','QUANTITY':'Qty',
    'FREE':'Free','FREE QTY':'Free',
    'BATCH':'Batch','B.NO':'Batch',
    'MFG':'Mfg','MFR':'Mfg','MANUFACTURER':'Mfg',
    'EXP':'Exp','EXPIRY':'Exp',
    'OLD MRP':'Old MRP','OLDMRP':'Old MRP',
    'NEW MRP':'New MRP','NEWMRP':'New MRP','MRP':'New MRP',
    'RATE':'Rate','PTR':'Rate','S.RATE':'Rate','SRATE':'Rate',
    'DIS':'Dis','DISC':'Dis','DISCOUNT':'Dis',
    'IGST':'IGST','I-GST':'IGST',
    'VALUE':'Value','AMOUNT':'Amount','NET AMOUNT':'Amount','TOTAL AMOUNT':'Amount',
}

def blank_row():
    return {c: '' for c in COLUMNS}

def extract_metadata(lines):
    rows = []
    current_section = ''
    i = 0
    n = len(lines)
    while i < n:
        raw = lines[i].strip()
        if not raw:
            i += 1
            continue
        up = raw.upper()
        sec = ''
        for kw, name in SECTION_KEYWORDS.items():
            if up.startswith(kw):
                sec = name
                raw = raw[len(kw):].strip()
                up = raw.upper()
                break
        if sec:
            current_section = sec
            if not raw:
                i += 1
                continue
        field = None
        value = ''
        if current_section in SECTION_FIELDS:
            best_idx = -1
            best_label = None
            for label in SECTION_FIELDS[current_section]:
                idx = up.find(label.upper())
                if idx != -1 and (best_idx == -1 or idx < best_idx):
                    best_idx = idx
                    best_label = label
            if best_label:
                field = best_label
                value = raw[idx + len(best_label):].strip()
                if not value and i + 1 < n:
                    value = lines[i + 1].strip()
        if field:
            r = blank_row()
            r['Section'] = current_section
            r['Field'] = field
            r['Value'] = value if value else 'Blank on PDF'
            rows.append(r)
        i += 1
    return rows

def extract_items(pdf):
    items = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if not table:
                continue
            header_idx = -1
            for ri, row in enumerate(table):
                joined = ' '.join([str(c or '') for c in row]).upper()
                score = sum(1 for k in ['HSN','PRODUCT','QTY','BATCH','MRP','AMOUNT','IGST'] if k in joined)
                if score >= 3:
                    header_idx = ri
                    break
            if header_idx == -1:
                continue
            header = [str(c or '').strip().upper() for c in table[header_idx]]
            col_map = []
            for h in header:
                canon = ''
                for key, val in ITEM_CANON.items():
                    if key in h or h in key:
                        canon = val
                        break
                col_map.append(canon)
            for ri in range(header_idx + 1, len(table)):
                row = table[ri]
                joined = ' '.join([str(c or '') for c in row]).upper()
                if any(k in joined for k in ['GRAND TOTAL','TOTAL','ROUND OFF','TAX SUMMARY','CLASS','SCHEME']):
                    continue
                if all((c is None or str(c).strip() == '') for c in row):
                    continue
                has_item = any(col_map[ci] for ci in range(len(row)) if ci < len(col_map) and row[ci] and str(row[ci]).strip())
                if not has_item:
                    continue
                r = blank_row()
                r['Section'] = 'Item'
                r['Field'] = 'Product'
                for ci, cell in enumerate(row):
                    if ci < len(col_map) and col_map[ci]:
                        r[col_map[ci]] = str(cell or '').strip()
                items.append(r)
    return items

@app.get('/health')
def health():
    return {'status': 'ok'}

@app.post('/extract-invoice')
async def extract_invoice(file: UploadFile = File(...)):
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail='Only PDF files are supported')
    data = await file.read()
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            all_text_lines = []
            for page in pdf.pages:
                txt = page.extract_text() or ''
                for ln in txt.splitlines():
                    all_text_lines.append(ln)
            meta_rows = extract_metadata(all_text_lines)
            item_rows = extract_items(pdf)
        rows = meta_rows + item_rows
        return {'success': True, 'columns': COLUMNS, 'rows': rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail='Error processing PDF: ' + str(e))


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
