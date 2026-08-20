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
    <div className="bg-white/55 border border-slate-300 px-3 py-2 rounded-xl">
      <div className="flex flex-nowrap items-end gap-3 text-xs overflow-x-auto">
        <h3 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1 pb-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-800" />
          <span>Invoice Metadata</span>
        </h3>
        <div className="flex-1 min-w-[180px]">
          <label className="text-slate-600 text-[11px]">Supplier Name</label>
          <input
            type="text"
            value={header.supplier}
            onChange={(e) => onChange({ ...header, supplier: e.target.value })}
            className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-800 mt-0.5 focus:border-indigo-500 outline-none"
            placeholder="Supplier"
          />
        </div>
        <div className="w-[140px]">
          <label className="text-slate-600 text-[11px]">Bill No.</label>
          <input
            type="text"
            value={header.billNo}
            onChange={(e) => onChange({ ...header, billNo: e.target.value })}
            className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-800 mt-0.5 focus:border-indigo-500 outline-none"
            placeholder="Bill No."
          />
        </div>
        <div className="w-[120px]">
          <label className="text-slate-600 text-[11px]">Bill Date</label>
          <input
            type="text"
            value={header.date}
            onChange={(e) => onChange({ ...header, date: e.target.value })}
            className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-800 mt-0.5 focus:border-indigo-500 outline-none"
            placeholder="Date"
          />
        </div>
        <button
          onClick={onSave}
          className="text-xs bg-cyan-800 hover:bg-cyan-900 text-white px-3 py-1.5 rounded-md font-semibold transition"
        >
          Save
        </button>
        <button
          onClick={onExport}
          disabled={!canExport}
          title={canExport ? 'Export Excel' : 'Add table rows first'}
          className="text-xs bg-cyan-800 hover:bg-cyan-900 text-white px-3 py-1.5 rounded-md font-semibold transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          Export Excel
        </button>
      </div>
    </div>
  );
}
