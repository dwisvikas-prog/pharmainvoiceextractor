import { THEME_OPTIONS, type AppThemeId } from '../utils/constants';

interface ThemeMenuProps {
  show: boolean;
  value: AppThemeId;
  onSelect: (id: AppThemeId) => void;
}

export default function ThemeMenu({ show, value, onSelect }: ThemeMenuProps) {
  if (!show) return null;

  return (
    <div className="absolute top-full mt-1 right-0 bg-white border border-slate-300 rounded-lg shadow-xl z-50 min-w-[168px] py-1">
      {THEME_OPTIONS.map((theme) => (
        <button
          key={theme.id}
          type="button"
          onClick={(e) => { e.stopPropagation(); onSelect(theme.id); }}
          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-100 ${
            value === theme.id ? 'font-semibold text-cyan-900' : 'text-slate-800'
          }`}
        >
          <span
            className="w-4 h-4 rounded border border-slate-400 shrink-0"
            style={{ background: theme.swatch }}
          />
          <span>{theme.label}</span>
        </button>
      ))}
    </div>
  );
}
