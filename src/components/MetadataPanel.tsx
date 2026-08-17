import { ShieldCheck } from 'lucide-react';
import { InvoiceHeader } from '../utils/ocr';

interface MetadataPanelProps {
  header: InvoiceHeader;
  onChange: (header: InvoiceHeader) => void;
  onSave: () => void;
}

export default function MetadataPanel({ header, onChange, onSave }: MetadataPanelProps) {
  return (
    <div className="bg-slate-800/80 border-2 border-indigo-500/50 p-3.5 rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-indigo-400" />
          <span>Invoice Metadata</span>
        </h3>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 px-2 py-0.5 rounded-md font-medium">
            Auto-export to Excel
          </span>
          <button
            onClick={onSave}
            className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-md font-semibold transition"
          >
            Save & Export Excel
          </button>
        </div>
      </div>
      <p className="text-[10px] text-slate-400">Ye values har row ke saath Excel me export hongi</p>
      <div className="grid grid-cols-1 gap-2 text-xs">
        <div>
          <label className="text-slate-400 text-[11px]">Supplier Name</label>
          <input
            type="text"
            value={header.supplier}
            onChange={(e) => onChange({ ...header, supplier: e.target.value })}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 mt-0.5 focus:border-indigo-500 outline-none"
            placeholder="e.g. HEALING PHARMACY CHD"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-slate-400 text-[11px]">Bill No.</label>
            <input
              type="text"
              value={header.billNo}
              onChange={(e) => onChange({ ...header, billNo: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 mt-0.5 focus:border-indigo-500 outline-none"
              placeholder="e.g. MK010343"
            />
          </div>
          <div>
            <label className="text-slate-400 text-[11px]">Bill Date</label>
            <input
              type="text"
              value={header.date}
              onChange={(e) => onChange({ ...header, date: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 mt-0.5 focus:border-indigo-500 outline-none"
              placeholder="e.g. 29-07-2026"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
