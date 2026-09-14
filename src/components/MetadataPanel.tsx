import { Download, ShieldCheck } from 'lucide-react';
import { InvoiceHeader } from '../utils/ocr';

interface MetadataPanelProps {
  header: InvoiceHeader;
  onChange: (header: InvoiceHeader) => void;
  onSave: () => void;
  onExport: () => void;
  canExport?: boolean;
}

export default function MetadataPanel({ header, onChange, onSave, onExport, canExport = true }: MetadataPanelProps) {
  return (
    <div className="bg-white border border-slate-200 px-3 py-3 rounded-2xl shadow-card">
      <div className="flex flex-nowrap items-end gap-3 text-xs overflow-x-auto">
        <h3 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1 pb-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
          <span>DWIS TAP Metadata</span>
        </h3>
        <div className="flex-1 min-w-[180px]">
          <label className="text-slate-500 text-[11px]">Supplier Name</label>
          <input
            type="text"
            value={header.supplier}
            onChange={(e) => onChange({ ...header, supplier: e.target.value })}
            className="w-full bg-white border border-slate-200 rounded-full px-3 py-1.5 text-slate-800 mt-0.5 focus:border-blue-500 outline-none"
            placeholder="Supplier"
          />
        </div>
        <div className="w-[140px]">
          <label className="text-slate-500 text-[11px]">Bill No.</label>
          <input
            type="text"
            value={header.billNo}
            onChange={(e) => onChange({ ...header, billNo: e.target.value })}
            className="w-full bg-white border border-slate-200 rounded-full px-3 py-1.5 text-slate-800 mt-0.5 focus:border-blue-500 outline-none"
            placeholder="Bill No."
          />
        </div>
        <div className="w-[120px]">
          <label className="text-slate-500 text-[11px]">Bill Date</label>
          <input
            type="text"
            value={header.date}
            onChange={(e) => onChange({ ...header, date: e.target.value })}
            className="w-full bg-white border border-slate-200 rounded-full px-3 py-1.5 text-slate-800 mt-0.5 focus:border-blue-500 outline-none"
            placeholder="Date"
          />
        </div>
        <button
          onClick={onSave}
          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-full font-semibold transition shadow-cta"
        >
          Save
        </button>
        <button
          onClick={onExport}
          disabled={!canExport}
          title={canExport ? 'Export Excel' : 'Add table rows first'}
          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-full font-semibold transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed shadow-cta"
        >
          <Download className="w-3.5 h-3.5" />
          Export Excel
        </button>
      </div>
    </div>
  );
}
