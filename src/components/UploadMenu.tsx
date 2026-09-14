// @ts-nocheck
import { useRef } from 'react';

interface UploadMenuProps {
  show: boolean;
  selectedType: 'excel' | 'text' | null;
  onSelectPdf: () => void;
  onSelectExcel: () => void;
  onSelectText: () => void;
  onSelectPdfToCsv?: () => void;
}

export default function UploadMenu({
  show,
  selectedType,
  onSelectPdf,
  onSelectExcel,
  onSelectText,
  onSelectPdfToCsv

}: UploadMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  if (!show) return null;

  const excelDisabled = selectedType === 'text';
  const textDisabled = selectedType === 'excel';

  return (
    <div
      ref={menuRef}
      className="absolute top-full mt-2 right-0 bg-white border border-slate-200 rounded-2xl shadow-card z-50 min-w-[220px] overflow-hidden py-1"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onSelectPdf(); }}
        className="w-full text-left px-4 py-2.5 text-sm text-slate-800 hover:bg-blue-50 flex items-center space-x-2"
      >
        <span>Upload Bill PDF / Image</span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onSelectExcel(); }}
        disabled={excelDisabled}
        className={`w-full text-left px-4 py-2.5 text-sm flex items-center space-x-2 ${excelDisabled ? 'text-slate-400 cursor-not-allowed' : 'text-slate-800 hover:bg-blue-50'}`}
      >
        <span>Upload Excel / CSV</span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onSelectText(); }}
        disabled={textDisabled}
        className={`w-full text-left px-4 py-2.5 text-sm flex items-center space-x-2 ${textDisabled ? 'text-slate-400 cursor-not-allowed' : 'text-slate-800 hover:bg-blue-50'}`}
      >
        <span>Upload Text File</span>
      </button>
      {/* PDF to CSV — hidden from UI
      {onSelectPdfToCsv && (
        <button
          onClick={(e) => { e.stopPropagation(); onSelectPdfToCsv(); }}
          className="w-full text-left px-4 py-2.5 text-sm text-slate-800 hover:bg-blue-50 flex items-center space-x-2"
        >
          <span>PDF to CSV Converter</span>
        </button>
      )}
      */}
    </div>
  );
}
