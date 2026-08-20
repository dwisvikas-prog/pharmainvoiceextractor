// @ts-nocheck
import { Trash2, Table as TableIcon } from 'lucide-react';
import { ERP_COLUMNS, ERP_COLUMN_MIN_WIDTH } from '../utils/constants';
import { ErpRow } from '../utils/ocr';

interface StudioTableProps {
  data: ErpRow[];
  onDeleteRow: (index: number) => void;
  onCellEdit: (rowIndex: number, colKey: string, value: string) => void;
}

export default function StudioTable({ data, onDeleteRow, onCellEdit }: StudioTableProps) {
  return (
    <div className="flex-1 overflow-auto">
      <table className="border-collapse text-left text-xs whitespace-nowrap">
        <thead className="bg-slate-800 text-slate-300 sticky top-0 z-20 shadow">
          <tr>
            <th className="p-2 border-b border-r border-slate-700 w-10 min-w-[40px] text-center font-bold sticky left-0 z-30 bg-slate-800">#</th>
            <th className="p-2 border-b border-r border-slate-700 w-12 min-w-[48px] text-center sticky left-10 z-30 bg-slate-800">Action</th>
            {ERP_COLUMNS.map((col, i) => (
              <th
                key={i}
                style={{ minWidth: ERP_COLUMN_MIN_WIDTH[col] || 80 }}
                className={`p-2 border-b border-r border-slate-700 font-bold ${
                  col === 'ITEM NAME' ? 'bg-white/40 font-semibold' : ''
                }`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 text-slate-200">
          {data.length > 0 ? (
            data.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-slate-800/40 transition">
                <td className="p-2 border-r border-slate-800 text-center text-slate-500 font-mono sticky left-0 bg-white z-10">
                  {rIdx + 1}
                </td>
                <td className="p-2 border-r border-slate-800 text-center sticky left-10 bg-white z-10">
                  <button
                    onClick={() => onDeleteRow(rIdx)}
                    className="p-1 text-slate-500 hover:text-rose-400 rounded transition"
                    title="Delete Row"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
                {ERP_COLUMNS.map((col, cIdx) => (
                  <td
                    key={cIdx}
                    style={{ minWidth: ERP_COLUMN_MIN_WIDTH[col] || 80 }}
                    className={`p-1 border-r border-slate-800/80 ${
                      col === 'ITEM NAME' ? 'bg-white/30 font-semibold' : ''
                    }`}
                  >
                    <input
                      type="text"
                      value={row[col] || ''}
                      onChange={(e) => onCellEdit(rIdx, col, e.target.value)}
                      className="w-full min-w-0 bg-transparent px-1.5 py-1 text-xs text-slate-200 border border-transparent hover:border-slate-700 focus:border-indigo-500 rounded outline-none transition"
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={ERP_COLUMNS.length + 2} className="p-12 text-center text-slate-500">
                <TableIcon className="w-10 h-10 mx-auto mb-2 opacity-40 text-slate-400" />
                <p className="text-sm font-semibold">Upload an invoice to extract rows</p>
                <p className="text-xs text-slate-600 mt-1">Use Upload → Bill PDF / Image, then Save metadata into the table</p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
