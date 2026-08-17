// @ts-nocheck
import { useRef } from 'react';

interface UploadMenuProps {
  show: boolean;
  selectedType: 'excel' | 'text' | null;
  onSelectPdf: () => void;
  onSelectExcel: () => void;
  onSelectText: () => void;
}

export default function UploadMenu({
  show,
  selectedType,
  onSelectPdf,
  onSelectExcel,
  onSelectText
}: UploadMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  if (!show) return null;

  const excelDisabled = selectedType === 'text';
  const textDisabled = selectedType === 'excel';

  return (
    <div
      ref={menuRef}
      className="absolute top-full mt-1 right-0 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 min-w-[200px]"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onSelectPdf(); }}
        className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 flex items-center space-x-2"
      >
        <span>Upload Bill PDF / Image</span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onSelectExcel(); }}
        disabled={excelDisabled}
        className={`w-full text-left px-4 py-2 text-sm flex items-center space-x-2 ${excelDisabled ? 'text-slate-500 cursor-not-allowed' : 'text-slate-200 hover:bg-slate-700'}`}
      >
        <span>Upload Excel / CSV</span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onSelectText(); }}
        disabled={textDisabled}
        className={`w-full text-left px-4 py-2 text-sm flex items-center space-x-2 ${textDisabled ? 'text-slate-500 cursor-not-allowed' : 'text-slate-200 hover:bg-slate-700'}`}
      >
        <span>Upload Text File</span>
      </button>
    </div>
  );
}
