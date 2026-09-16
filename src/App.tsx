// @ts-nocheck
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.message?.includes('503') ? 503 : (err?.status || 0);
      if ((status === 503 || status === 429) && i < maxRetries - 1) {
        const wait = Math.pow(2, i) * 1000;
        console.log(`API busy, retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}


import { useState, useEffect, useRef, Fragment } from 'react';
import {
  FileText, Upload, Download, Sparkles, RefreshCw,
  Eye, Table as TableIcon, ZoomIn, ZoomOut,
  ChevronRight, ChevronLeft, ChevronDown, Search, Plus, Scan, Trash2,
  Pill, Zap, RotateCcw, RotateCw, Menu, X, CheckCircle2, Save, Mail, Clock
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import * as XLSX from 'xlsx';
import { ERP_COLUMNS, SHOW_RAW_PDF_TEXT_TAB, SHOW_LOCAL_OCR, SHOW_AUTO_FETCH_ON_UPLOAD, SHOW_AUTO_FILL_HEADER, SHOW_PAYMENT_CHECKOUT, ZERO_FILL_COLUMNS, TAP_PLAN_FEATURES, TAP_TIER_INCLUDED } from './utils/constants';
import { ErpRow, InvoiceHeader, RawTextLine, normalizeToErpRows, performGeminiOcrOnCanvas, performTesseractOcrOnCanvas, parseTesseractTextToStructuredData, performGeminiVerbatimOcrOnCanvas } from './utils/ocr';
import { extractAllPagesData, loadPdfDocument, renderPdfPageToCanvas } from './utils/pdfExtraction';
import UploadMenu from './components/UploadMenu';
import AccessPaywall, { PlanCheckoutGrid } from './components/AccessPaywall';
import MetadataPanel from './components/MetadataPanel';
import StudioTable from './components/StudioTable';
import AdminPanel from './components/AdminPanel';
import { payForPlan } from './utils/payments';
import { getStoredSession, getDaysUntilExpiry, isExpiryWarningWindow, loginUser, logoutSession, registerUser, redeemPasscode, resendConfirmationEmail, TRIAL_DAYS, PLAN_PRICING, getAccessBlockReason, getVerifyOcrLimit, recordVerifyOcrPages, isSessionStillActive, SessionInvalidatedError, type AuthSession, type PlanId, type BillingCycle } from './utils/auth';
import dwisLogo from './assets/dwis-logo.png';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const AI_OCR_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await task(values[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function getRetryDelayMilliseconds(message: string): number {
  const match = message.match(/(?:retry in|retryDelay[^0-9]*)(\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : 60_000;
}

// Neutralizes values that would be interpreted as a spreadsheet formula
// (CSV/Excel formula injection) when the exported file is reopened, without
// disturbing ordinary negative numbers (e.g. "-5") or dates.
const FORMULA_TRIGGER_RE = /^[=+@]|^-(?!\d)/;
function sanitizeForSpreadsheet(value: string): string {
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

function assignUniqueRandomCodes(rows: ErpRow[]): ErpRow[] {
  const used = new Set<string>();
  for (const row of rows) {
    const existing = String(row?.CODE ?? '').trim();
    if (/^\d{3}$/.test(existing) && existing !== '000') used.add(existing);
  }
  return rows.map((row) => {
    let code = String(row?.CODE ?? '').trim();
    if (!/^\d{3}$/.test(code) || code === '000') {
      do {
        code = String(100 + Math.floor(Math.random() * 900));
      } while (used.has(code));
    }
    used.add(code);
    const next: ErpRow = { ...row, CODE: code };
    ZERO_FILL_COLUMNS.forEach((col) => {
      if (!String(next[col] ?? '').trim()) next[col] = '0';
    });
    return next;
  });
}

const landingStats = [
  { value: 'PDF', label: 'Upload' },
  { value: 'OCR', label: 'Pages' },
  { value: '34', label: 'ERP cols' },
  { value: 'XLSX', label: 'Export' }
];

const landingFeatures = [
  {
    title: 'Invoice upload',
    description: 'Drop a bill PDF or image into TAP. Preview the page, then set cutoffs before you extract.',
    accent: 'from-blue-500 to-blue-700',
    icon: Upload
  },
  {
    title: 'OCR current & all pages',
    description: SHOW_LOCAL_OCR
      ? 'Run Local or Verify OCR on the page you are viewing, or process every page of a multi-page invoice.'
      : 'Run Verify OCR on the page you are viewing, or process every page of a multi-page invoice.',
    accent: 'from-blue-600 to-indigo-600',
    icon: Scan
  },
  {
    title: '34-column ERP table',
    description: 'Review supplier, bill number, date, and line items in an editable table that matches your ERP layout.',
    accent: 'from-sky-500 to-blue-600',
    icon: TableIcon
  },
  {
    title: 'Excel export',
    description: 'Save metadata into rows, then export a clean workbook when the table has data ready for operations.',
    accent: 'from-blue-500 to-sky-600',
    icon: Download
  }
];

const workflowSteps = [
  'Upload invoice PDF or image',
  'Review metadata and 34-col table',
  'Save, then export Excel'
];

const tapTools = [
  { label: 'PDF / Image', icon: FileText },
  { label: 'Preview cutoffs', icon: Eye },
  { label: 'Metadata Save', icon: Save },
  { label: 'OCR current page', icon: Scan },
  { label: 'OCR all pages', icon: Zap },
  { label: 'Excel export', icon: Download }
];

type PricingTab = 'trial' | 'monthly' | 'annually';

const PRICING_CONTACT = { tel: '9988336023', href: 'tel:9988336023' };

const tapFaqs = [
  {
    question: 'Does DWIS TAP work with PDFs and scanned invoices?',
    answer: 'Yes. Upload a bill PDF or image, set preview cutoffs, then extract into the 34-column table. Use OCR on the current page or all pages when the PDF has more than one sheet.'
  },
  {
    question: 'Where do I login or register?',
    answer: 'Use the Account tab, or the Login / Register buttons. After you sign in, the invoice studio opens with upload, OCR, Save, and Excel export.'
  },
  {
    question: 'Can I export Excel?',
    answer: 'Yes. Save supplier, bill number, and date into the rows, then Export Excel when the table has product lines.'
  },
  {
    question: 'What happens when trial or OCR pages end?',
    answer: 'The invoice studio locks. Contact us to continue. After the next plan is active you can extract again. Extra 15 days are available as a bonus offer code.'
  }
];

function TapPricingCard({
  badge,
  title,
  subtitle,
  price,
  howToGet,
  howToUse,
  ocrNote,
  includedCount
}: {
  badge: string;
  title: string;
  subtitle: string;
  price: string;
  howToGet: string;
  howToUse: string;
  ocrNote: string;
  includedCount: number;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg">
      <div className="inline-flex w-fit rounded bg-[#1e86bb] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">{badge}</div>
      <h5 className="mt-3 text-lg font-bold text-slate-900">{title}</h5>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{price}</p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">How you get it</p>
      <p className="mt-1 text-sm text-slate-600">{howToGet}</p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">How you use it</p>
      <p className="mt-1 text-sm text-slate-600">{howToUse}</p>
      <p className="mt-3 text-sm font-medium text-slate-800">{ocrNote}</p>
      <ul className="mt-4 flex-1 space-y-1.5 text-sm">
        {TAP_PLAN_FEATURES.map((feature, i) => (
          <li key={feature} className={i < includedCount ? 'text-slate-800' : 'text-slate-400 line-through'}>
            {feature}
          </li>
        ))}
      </ul>
      <a
        href={PRICING_CONTACT.href}
        className="mt-5 inline-flex items-center justify-center rounded-lg bg-[#1e86bb] px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-[#1970a0]"
      >
        Contact us
      </a>
    </div>
  );
}

export default function App() {
  const [tableData, setTableData] = useState<ErpRow[]>([]);
  const [docHeaderInfo, setDocHeaderInfo] = useState<InvoiceHeader>({
    supplier: '',
    billNo: '',
    date: ''
  });
  const [activeTab, setActiveTab] = useState<'studio' | 'raw'>('studio');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Ready for processing');
  const [isDragging, setIsDragging] = useState(false);
  const [autoFillHeaderInfo, setAutoFillHeaderInfo] = useState(SHOW_AUTO_FILL_HEADER);
  const applyAutoFill = SHOW_AUTO_FILL_HEADER && autoFillHeaderInfo;
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isScannedPdf, setIsScannedPdf] = useState(false);
  const [rawTextLines, setRawTextLines] = useState<RawTextLine[]>([]);
  const [rawSearchTerm, setRawSearchTerm] = useState('');
  const [tesseractProgress, setTesseractProgress] = useState({ status: '', progress: 0 });
  const [ocrUsageCount, setOcrUsageCount] = useState(0);
  const [selectedUploadType, setSelectedUploadType] = useState<'excel' | 'text' | null>(null);
  const [showMasterMenu, setShowMasterMenu] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('');
  const [resendStatus, setResendStatus] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setInterval(() => {
      setResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendCooldown]);
  const [activeView, setActiveView] = useState<'extractor' | 'csv'>('extractor');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string>('');
  const [isCsvProcessing, setIsCsvProcessing] = useState(false);
  const [csvStatus, setCsvStatus] = useState('');
  const [aiRetryUntil, setAiRetryUntil] = useState(0);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(true);
  const [tableTopCutoff, setTableTopCutoff] = useState(12);
  const [tableBottomCutoff, setTableBottomCutoff] = useState(88);
  const [previewWidth, setPreviewWidth] = useState(380);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [sessionKickedOutMessage, setSessionKickedOutMessage] = useState('');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [passcode, setPasscode] = useState('');
  const [passcodeMessage, setPasscodeMessage] = useState('');
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [planLevel, setPlanLevel] = useState<'basic' | 'pro'>('basic');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [pricingTab, setPricingTab] = useState<PricingTab>('trial');
  const [planExpiresAt, setPlanExpiresAt] = useState<string>(() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const cutoffDragRef = useRef<null | 'top' | 'bottom'>(null);
  const splitDragRef = useRef(false);
  const splitStartRef = useRef({ x: 0, w: 380 });
  const cutoffsRef = useRef({ top: 12, bottom: 88 });
  const imageSourceRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const ocrCacheKeyRef = useRef<string | null>(null);
  const aiRateLimited = aiRetryUntil > Date.now();

  const saveOcrCache = (rows: ErpRow[], header: InvoiceHeader) => {
    if (!ocrCacheKeyRef.current) return;
    try {
      localStorage.setItem(ocrCacheKeyRef.current, JSON.stringify({ rows, header }));
    } catch (error) {
      console.warn('Could not cache OCR result:', error);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('invoice_metadata');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.supplier || parsed.billNo || parsed.date) {
          setDocHeaderInfo(parsed);
        }
      } catch (e) {
        console.error('Failed to load saved metadata:', e);
      }
    }
  }, []);

  useEffect(() => {
    const today = new Date().toDateString();
    const stored = localStorage.getItem('gemini_ocr_usage');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.date === today) {
        setOcrUsageCount(parsed.count || 0);
      } else {
        localStorage.setItem('gemini_ocr_usage', JSON.stringify({ date: today, count: 0 }));
      }
    } else {
      localStorage.setItem('gemini_ocr_usage', JSON.stringify({ date: new Date().toDateString(), count: 0 }));
    }
  }, []);

  useEffect(() => {
    document.body.classList.add('brand-app');
  }, []);

  useEffect(() => {
    let active = true;
    getStoredSession().then((storedSession) => {
      if (active && storedSession) setSession(storedSession);
    });
    return () => {
      active = false;
    };
  }, []);

  // Single-active-session enforcement: if another device logs into this
  // account, our claimed session token stops matching the database's
  // current one. Poll for that regularly and on tab focus, and kick this
  // device out immediately when it happens.
  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    const checkStillActive = async () => {
      const stillActive = await isSessionStillActive(session);
      if (!cancelled && !stillActive) {
        await logoutSession(session);
        setSession(null);
        setSessionKickedOutMessage(new SessionInvalidatedError().message);
      }
    };

    const intervalId = window.setInterval(checkStillActive, 20000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkStillActive();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session?.sessionToken]);

  const openAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setAuthError('');
    window.requestAnimationFrame(() => {
      document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setAuthSuccess('');

    try {
      const nextSession = authMode === 'register'
        ? await registerUser({ name: authName, email: authEmail, password: authPassword })
        : await loginUser({ email: authEmail, password: authPassword });
      setSession(nextSession);
      setAuthSuccess(authMode === 'register' ? 'Registration successful. Your account is ready.' : 'Login successful.');
      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname || '/');
      }
      setAuthName('');
      setAuthEmail('');
      setAuthPassword('');
    } catch (error: any) {
      const message = error?.message || 'Authentication failed.';
      if (message.includes('Check your email to confirm') || message.toLowerCase().includes('email not confirmed')) {
        setPendingConfirmationEmail(authEmail.trim());
        setResendStatus('');
        setResendCooldown(0);
        setAuthName('');
        setAuthPassword('');
        return;
      }
      setAuthError(message);
    }
  };

  const handleResendConfirmation = async () => {
    if (!pendingConfirmationEmail || resendCooldown > 0) return;
    setIsResending(true);
    setResendStatus('');
    try {
      await resendConfirmationEmail(pendingConfirmationEmail);
      setResendStatus('Confirmation email sent again. Check your inbox (and spam folder).');
    } catch (error: any) {
      const message = error?.message || 'Could not resend email. Try again shortly.';
      const waitMatch = message.match(/after (\d+) seconds?/i);
      if (waitMatch) {
        setResendCooldown(Number(waitMatch[1]));
      } else {
        setResendStatus(message);
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleLogout = async () => {
    await logoutSession(session);
    setSession(null);
    setAuthSuccess('Logged out successfully.');
  };

  // Shared by the header "Extend trial" modal and the inline passcode box on
  // the locked/paywall screen - both just need a code in, result out.
  const submitPasscode = async (code: string): Promise<{ ok: boolean; message: string; invalidated?: boolean }> => {
    if (!session) return { ok: false, message: 'Not logged in.' };
    try {
      const next = await redeemPasscode(session, code);
      setSession(next);
      return { ok: true, message: `Trial extended by ${TRIAL_DAYS} days.` };
    } catch (error: any) {
      if (error instanceof SessionInvalidatedError) {
        setSession(null);
        setSessionKickedOutMessage(error.message);
        return { ok: false, message: error.message, invalidated: true };
      }
      return { ok: false, message: error?.message || 'Invalid passcode. Please try again.' };
    }
  };

  const handlePasscodeSubmit = async () => {
    const result = await submitPasscode(passcode);
    if (result.invalidated) {
      setShowPasscodeModal(false);
      return;
    }
    setPasscodeMessage(result.message);
    if (result.ok) {
      setPasscode('');
      setShowPasscodeModal(false);
    }
  };

  const handleActivatePlan = async (plan: Exclude<PlanId, 'trial'>, cycle: BillingCycle) => {
    if (!session) return;
    setStatusMsg('Opening payment…');
    try {
      const result = await payForPlan({ planId: plan, billingCycle: cycle, name: session.user.name, email: session.user.email });
      setSession((prev) => prev ? { ...prev, plan: result.plan as PlanId, billingCycle: result.billingCycle as BillingCycle, expiresAt: result.expiresAt } : prev);
      setStatusMsg(`Payment successful. ${plan === 'pro' ? 'Premium' : 'Basic'} plan is now active.`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (error: any) {
      setStatusMsg(error?.message || 'Payment could not be completed.');
    }
  };

  const handlePlanSelection = (nextPlan: 'basic' | 'pro', nextCycle: 'monthly' | 'yearly') => {
    setPlanLevel(nextPlan);
    setBillingCycle(nextCycle);
    const days = nextCycle === 'monthly' ? 30 : 365;
    const nextExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    setPlanExpiresAt(nextExpiry);
    try { localStorage.setItem('dwis_plan', JSON.stringify({ planLevel: nextPlan, billingCycle: nextCycle, planExpiresAt: nextExpiry })); } catch (_) {}
  };

  const planPrice = PLAN_PRICING[planLevel][billingCycle];
  const planDaysLeft = getDaysUntilExpiry(planExpiresAt);
  const showPlanExpiryWarning = isExpiryWarningWindow(planExpiresAt);

  const incrementOcrUsage = (count = 1) => {
    setOcrUsageCount(prev => {
      const newCount = prev + count;
      localStorage.setItem('gemini_ocr_usage', JSON.stringify({ date: new Date().toDateString(), count: newCount }));
      return newCount;
    });
  };

  const drawImagePreview = (image: HTMLImageElement, rotation: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const isSideways = rotation % 180 !== 0;
    canvas.width = isSideways ? image.height : image.width;
    canvas.height = isSideways ? image.width : image.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    context.restore();
  };

  const rotatePreview = (direction: -90 | 90) => {
    setPreviewRotation(current => {
      const next = (current + direction + 360) % 360;
      setStatusMsg(`Preview rotated ${next}°. OCR will use this orientation.`);
      return next;
    });
  };

  useEffect(() => {
    cutoffsRef.current = { top: tableTopCutoff, bottom: tableBottomCutoff };
  }, [tableTopCutoff, tableBottomCutoff]);

  const applyCutoffFromPointer = (clientY: number) => {
    const wrap = previewWrapRef.current;
    const which = cutoffDragRef.current;
    if (!wrap || !which) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.height <= 0) return;
    const pct = Math.max(2, Math.min(98, ((clientY - rect.top) / rect.height) * 100));
    const { top, bottom } = cutoffsRef.current;
    if (which === 'top') {
      const next = Math.min(pct, bottom - 8);
      setTableTopCutoff(next);
      cutoffsRef.current.top = next;
    } else {
      const next = Math.max(pct, top + 8);
      setTableBottomCutoff(next);
      cutoffsRef.current.bottom = next;
    }
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      applyCutoffFromPointer(event.clientY);
      if (splitDragRef.current) {
        const next = Math.max(240, Math.min(560, splitStartRef.current.w + (event.clientX - splitStartRef.current.x)));
        setPreviewWidth(next);
      }
    };
    const onUp = () => {
      cutoffDragRef.current = null;
      splitDragRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const ocrPdfPagesToRows = async (
    pdf: any,
    pageNums: number[],
    header: InvoiceHeader,
    startIndex: number
  ): Promise<ErpRow[]> => {
    let combinedItems: any[] = [];
    let finalHeader = { ...header };
    for (const pageNum of pageNums) {
      setStatusMsg(`OCR page ${pageNum} of ${pdf.numPages}...`);
      const tempCanvas = document.createElement('canvas');
      const ctx = tempCanvas.getContext('2d')!;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5, rotation: previewRotation });
      tempCanvas.width = viewport.width;
      tempCanvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const rawText = await performTesseractOcrOnCanvas(tempCanvas, setTesseractProgress);
      if (!rawText) continue;
      const parsed = parseTesseractTextToStructuredData(rawText, finalHeader, applyAutoFill);
      if (parsed.header.supplier && !finalHeader.supplier) finalHeader.supplier = parsed.header.supplier;
      if (parsed.header.billNo && !finalHeader.billNo) finalHeader.billNo = parsed.header.billNo;
      if (parsed.header.date && !finalHeader.date) finalHeader.date = parsed.header.date;
      if (Array.isArray(parsed.items)) combinedItems = [...combinedItems, ...parsed.items];
    }
    if (finalHeader.supplier || finalHeader.billNo || finalHeader.date) {
      setDocHeaderInfo(finalHeader);
    }
    return normalizeToErpRows(combinedItems, finalHeader, applyAutoFill, startIndex);
  };

  const processFile = async (file: File) => {
    if (!file) return;

    setIsProcessing(true);
    setPreviewZoom(1);
    setStatusMsg(`Loading "${file.name}"...`);
    setTableData([]);
    const freshHeader = { supplier: '', billNo: '', date: '' };
    setDocHeaderInfo(freshHeader);
    setIsScannedPdf(false);
    setPreviewRotation(0);
    imageSourceRef.current = null;
    ocrCacheKeyRef.current = `invoice_ocr_cache_v3:${file.name}:${file.size}:${file.lastModified}`;

    if (file.type.startsWith('image/')) {
      setIsScannedPdf(true);
      setPdfDoc(null);
      setTotalPages(1);
      setCurrentPage(1);

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          imageSourceRef.current = img;
          drawImagePreview(img, 0);
          setStatusMsg("Image loaded. Use Verify OCR to extract data.");
          setIsProcessing(false);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
      return;
    }

    try {
      const loadedPdf = await loadPdfDocument(file);
      setPdfDoc(loadedPdf);
      setTotalPages(loadedPdf.numPages);
      setCurrentPage(1);

      try {
        if (!SHOW_AUTO_FETCH_ON_UPLOAD) {
          setStatusMsg(`PDF loaded (${loadedPdf.numPages} page(s)). Use Verify OCR to extract data.`);
          return;
        }

        const cached = localStorage.getItem(ocrCacheKeyRef.current);
        if (cached) {
          const { rows, header } = JSON.parse(cached);
          if (Array.isArray(rows) && header) {
            setTableData(assignUniqueRandomCodes(rows));
            setDocHeaderInfo(header);
            setStatusMsg(`Loaded ${rows.length} cached OCR rows instantly.`);
            return;
          }
        }
      } catch (cacheError) {
        console.warn('Could not read OCR cache:', cacheError);
      }

      let result;
      try {
        result = await extractAllPagesData(loadedPdf, freshHeader, tableTopCutoff, tableBottomCutoff);
      } catch (extractionError) {
        console.warn('[PDF] Fast extraction failed:', extractionError);
        setIsScannedPdf(true);
        setStatusMsg('Fast PDF extraction failed. Use Verify OCR if needed.');
        return;
      }
      setTableData(assignUniqueRandomCodes(result.rows));
      setDocHeaderInfo({ supplier: result.supplier, billNo: result.billNo, date: result.date });

      if (result.pagesNeedingOcr?.length > 0) {
        setIsScannedPdf(true);
        setStatusMsg(`Checking page ${result.pagesNeedingOcr.join(', ')} for more items (OCR)...`);
        const extraRows = await ocrPdfPagesToRows(
          loadedPdf,
          result.pagesNeedingOcr,
          { supplier: result.supplier, billNo: result.billNo, date: result.date },
          result.rows.length
        );
        const merged = assignUniqueRandomCodes([...result.rows, ...extraRows]);
        setTableData(merged);
        setStatusMsg(
          extraRows.length
            ? `Extracted ${merged.length} rows from ${loadedPdf.numPages} pages.`
            : `Page ${result.pagesNeedingOcr.join(', ')} had no extra table. Use Verify OCR if items are missing.`
        );
      } else if (result.needsAiVerification) {
        setIsScannedPdf(true);
        setStatusMsg('Fast extraction needs verification. Use Verify OCR for unclear pages.');
      } else {
        setIsScannedPdf(false);
        saveOcrCache(result.rows, {
          supplier: result.supplier,
          billNo: result.billNo,
          date: result.date
        });
        setStatusMsg(`Extracted ${result.rows.length} rows from all ${loadedPdf.numPages} pages!`);
      }
    } catch (err) {
      console.error('[PDF] Error:', err);
      setStatusMsg("Error reading PDF file: " + (err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
      e.target.value = '';
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setStatusMsg(`Reading "${file.name}"...`);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (!jsonData || jsonData.length === 0) {
          setStatusMsg("Excel file is empty.");
          setIsProcessing(false);
          return;
        }

        const firstRow = jsonData[0].map((h: any) => String(h).trim().toUpperCase());
        const hasHeaders = firstRow.some(h =>
          ["ITEM", "PRODUCT", "DESCRIPTION", "QTY", "QUANTITY", "BATCH", "EXPIRY", "PACK", "MRP", "RATE", "AMOUNT", "HSN", "CGST", "SGST", "IGST"].includes(h)
        );

        let rows: ErpRow[];
        if (hasHeaders) {
          rows = jsonData.slice(1).map((row: any[]) => {
            const rowObj: ErpRow = {};
            ERP_COLUMNS.forEach(col => rowObj[col] = "");
            firstRow.forEach((header, idx) => {
              if (header === "ITEM NAME" || header === "ITEM" || header === "PRODUCT") rowObj["ITEM NAME"] = String(row[idx] || "");
              else if (header === "QTY" || header === "QUANTITY") rowObj["QTY"] = String(row[idx] || "");
              else if (header === "BATCH") rowObj["BATCH"] = String(row[idx] || "");
              else if (header === "EXPIRY") rowObj["EXPIRY"] = String(row[idx] || "");
              else if (header === "PACK") rowObj["PACK"] = String(row[idx] || "");
              else if (header === "MRP") rowObj["MRP"] = String(row[idx] || "");
              else if (["FTRATE", "F RATE", "F.RATE", "F-RATE", "F_RATE", "RATE", "PRATE", "P RATE", "P.RATE", "PRICE"].includes(header)) rowObj["FTRATE"] = String(row[idx] || "");
              else if (header === "SRATE") rowObj["SRATE"] = String(row[idx] || "");
              else if (header === "AMOUNT") rowObj["AMOUNT"] = String(row[idx] || "");
              else if (header === "HSN" || header === "HSNCODE") rowObj["HSNCODE"] = String(row[idx] || "");
              else if (header === "CGST") rowObj["CGST"] = String(row[idx] || "");
              else if (header === "SGST") rowObj["SGST"] = String(row[idx] || "");
              else if (header === "IGST") rowObj["IGST"] = String(row[idx] || "");
              else if (header === "COMPANY" || header === "MFG") rowObj["COMPANY"] = String(row[idx] || "");
              else if (header === "SUPPLIER") rowObj["SUPPLIER"] = String(row[idx] || "");
              else if (header === "BILL NO." || header === "BILL NO") rowObj["BILL NO."] = String(row[idx] || "");
              else if (header === "DATE") rowObj["DATE"] = String(row[idx] || "");
            });
            rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
            return rowObj;
          });
        } else {
          rows = jsonData.map((row: any[]) => {
            const rowObj: ErpRow = {};
            ERP_COLUMNS.forEach(col => rowObj[col] = "");
            row.forEach((cell: any, idx: number) => {
              if (idx < ERP_COLUMNS.length) rowObj[ERP_COLUMNS[idx]] = String(cell || "");
            });
            rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
            return rowObj;
          });
        }

        if (rows.length > 0) {
          setTableData(assignUniqueRandomCodes(rows));
          setStatusMsg(`Loaded ${rows.length} rows from Excel!`);
        } else {
          setStatusMsg("No valid data rows found in Excel file.");
        }
      } catch (err) {
        console.error("Excel Error:", err);
        setStatusMsg("Error reading Excel file: " + (err as Error).message);
      } finally {
        setIsProcessing(false);
        e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleTextUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setStatusMsg(`Reading text file "${file.name}"...`);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length === 0) {
          setStatusMsg("Text file is empty.");
          setIsProcessing(false);
          return;
        }

        const firstLine = lines[0];
        let rows: ErpRow[] = [];

        if (firstLine.includes('|')) {
          rows = lines.map(line => {
            const fields = line.split('|').map(f => f.trim()).slice(1);
            const rowObj: ErpRow = {};
            ERP_COLUMNS.forEach(col => rowObj[col] = "");
            fields.forEach((field, idx) => {
              if (idx < ERP_COLUMNS.length) rowObj[ERP_COLUMNS[idx]] = field;
            });
            rowObj["_RAW_TEXT"] = fields.join(' | ');
            return rowObj;
          });
        } else if (firstLine.includes(',') || firstLine.includes('\t')) {
          const delimiter = firstLine.includes('\t') ? '\t' : ',';
          const jsonData = lines.map(l => l.split(delimiter));
          const firstRow = jsonData[0].map((h: any) => String(h).trim().toUpperCase());
          const hasHeaders = firstRow.some(h =>
            ["ITEM", "PRODUCT", "QTY", "BATCH", "EXPIRY", "PACK", "MRP", "RATE", "AMOUNT"].includes(h)
          );

          if (hasHeaders) {
            rows = jsonData.slice(1).map((row: any[]) => {
              const rowObj: ErpRow = {};
              ERP_COLUMNS.forEach(col => rowObj[col] = "");
              firstRow.forEach((header, idx) => {
                if (header === "ITEM NAME" || header === "ITEM" || header === "PRODUCT") rowObj["ITEM NAME"] = String(row[idx] || "");
                else if (header === "QTY" || header === "QUANTITY") rowObj["QTY"] = String(row[idx] || "");
                else if (header === "BATCH") rowObj["BATCH"] = String(row[idx] || "");
                else if (header === "EXPIRY") rowObj["EXPIRY"] = String(row[idx] || "");
                else if (header === "PACK") rowObj["PACK"] = String(row[idx] || "");
                else if (header === "MRP") rowObj["MRP"] = String(row[idx] || "");
                else if (["FTRATE", "F RATE", "F.RATE", "F-RATE", "F_RATE", "RATE", "PRATE", "P RATE", "P.RATE", "PRICE"].includes(header)) rowObj["FTRATE"] = String(row[idx] || "");
                else if (header === "SRATE") rowObj["SRATE"] = String(row[idx] || "");
                else if (header === "AMOUNT") rowObj["AMOUNT"] = String(row[idx] || "");
              });
              rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
              return rowObj;
            });
          } else {
            rows = jsonData.map((row: any[]) => {
              const rowObj: ErpRow = {};
              ERP_COLUMNS.forEach(col => rowObj[col] = "");
              row.forEach((cell: any, idx: number) => {
                if (idx < ERP_COLUMNS.length) rowObj[ERP_COLUMNS[idx]] = String(cell || "");
              });
              rowObj["_RAW_TEXT"] = row.map((cell: any) => cell !== undefined ? String(cell) : "").join(" | ");
              return rowObj;
            });
          }
        } else {
          const rowObj: ErpRow = {};
          ERP_COLUMNS.forEach(col => rowObj[col] = "");
          rowObj["_RAW_TEXT"] = firstLine;
          rowObj["ITEM NAME"] = firstLine;
          rows = [rowObj];
        }

        if (rows.length > 0) {
          setTableData(assignUniqueRandomCodes(rows));
          setStatusMsg(`Loaded ${rows.length} rows from text file!`);
        } else {
          setStatusMsg("No valid data rows found in text file.");
        }
      } catch (err) {
        console.error("Text File Error:", err);
        setStatusMsg("Error reading text file: " + (err as Error).message);
      } finally {
        setIsProcessing(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleRunAiOcr = async (
    targetPages: 'current' | 'all' = 'current',
    documentOverride?: any,
    headerOverride?: InvoiceHeader
  ) => {
    const documentToProcess = documentOverride || pdfDoc;
    const isImageDocument = !documentToProcess && Boolean(imageSourceRef.current && canvasRef.current);
    if (!documentToProcess && !isImageDocument) {
      setStatusMsg("Please upload a PDF or image invoice first.");
      return;
    }
    if (aiRateLimited) {
      setStatusMsg('OCR is temporarily rate-limited. Wait before retrying Verify OCR.');
      return;
    }
    if (session && getAccessBlockReason(session) !== 'ok') {
      setStatusMsg('Access locked. Contact us to continue.');
      return;
    }
    if (session && targetPages === 'all' && session.plan !== 'pro') {
      setStatusMsg('All-pages Verify OCR is on Premium. Contact us to upgrade.');
      return;
    }
    if (session) {
      const pagesNeeded = pdfDoc && targetPages === 'all' ? pdfDoc.numPages : 1;
      if (session.ocrUsed + pagesNeeded > getVerifyOcrLimit(session.plan)) {
        setStatusMsg('Verify OCR page limit reached. Contact us for the next plan.');
        return;
      }
    }

    setIsProcessing(true);
    setStatusMsg("Initializing Verify OCR...");

    try {
      let combinedItems: any[] = [];
      let finalHeader = { ...(headerOverride || docHeaderInfo) };

      const pagesToProcess = documentToProcess && targetPages === 'all'
        ? Array.from({ length: documentToProcess.numPages }, (_, i) => i + 1)
        : [currentPage];

      const ocrResults = await mapWithConcurrency(pagesToProcess, AI_OCR_CONCURRENCY, async (pageNum) => {
        setStatusMsg(`Rendering Page ${pageNum} for Verify OCR...`);
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d')!;
        if (documentToProcess) {
          const page = await documentToProcess.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.0, rotation: previewRotation });
          tempCanvas.width = viewport.width;
          tempCanvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
        } else if (canvasRef.current) {
          tempCanvas.width = canvasRef.current.width;
          tempCanvas.height = canvasRef.current.height;
          ctx.drawImage(canvasRef.current, 0, 0);
        }

        const cropTop = 0;
        const cropBottom = Math.ceil(tempCanvas.height * (tableBottomCutoff / 100));
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = tempCanvas.width;
        croppedCanvas.height = cropBottom - cropTop;
        const cropCtx = croppedCanvas.getContext('2d')!;
        cropCtx.drawImage(tempCanvas, 0, cropTop, tempCanvas.width, cropBottom - cropTop, 0, 0, croppedCanvas.width, croppedCanvas.height);

        setStatusMsg(`Analyzing Page ${pageNum} with Verify OCR...`);
        const ocrData = await withRetry(() => performGeminiOcrOnCanvas(croppedCanvas));
        incrementOcrUsage(1);
        return ocrData;
      });
      if (session) setSession(await recordVerifyOcrPages(session, pagesToProcess.length));
      for (const ocrData of ocrResults) {
        if (ocrData) {
          if (ocrData.supplier && !finalHeader.supplier) finalHeader.supplier = ocrData.supplier;
          if (ocrData.billNo && !finalHeader.billNo) finalHeader.billNo = ocrData.billNo;
          if (ocrData.date && !finalHeader.date) finalHeader.date = ocrData.date;

          if (Array.isArray(ocrData.items)) {
            combinedItems = [...combinedItems, ...ocrData.items];
          }
        }
      }

      const normalizedRows = normalizeToErpRows(
        combinedItems,
        finalHeader,
        applyAutoFill,
        targetPages === 'all' ? 0 : tableData.length
      );

      if (normalizedRows.length > 0) {
        setTableData(assignUniqueRandomCodes(targetPages === 'all' ? normalizedRows : [...tableData, ...normalizedRows]));
        setDocHeaderInfo(finalHeader);
        if (targetPages === 'all') saveOcrCache(normalizedRows, finalHeader);
        setIsScannedPdf(false);
        setStatusMsg(`Extracted ${normalizedRows.length} items using Verify OCR!`);
      } else {
        console.warn("No items extracted. Extracted data:", combinedItems);
        console.warn("Final header:", finalHeader);
        setStatusMsg(`Verify OCR returned data but no items detected. Improve image clarity or try again.`);
      }
    } catch (err) {
      if (err instanceof SessionInvalidatedError) {
        setSession(null);
        setSessionKickedOutMessage(err.message);
        setIsProcessing(false);
        return;
      }
      console.error("AI OCR Error:", err);
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('429')) {
        const delay = getRetryDelayMilliseconds(message);
        setAiRetryUntil(Date.now() + delay);
        window.setTimeout(() => setAiRetryUntil(0), delay);
        setStatusMsg(`OCR quota reached. Verify OCR is paused; retry after ${Math.ceil(delay / 1000)} seconds.`);
      } else if (SHOW_LOCAL_OCR && message.includes('Falling back to Local OCR')) {
        // Auto-fallback to Local OCR (Tesseract)
        console.log("AI failed, auto-fallback to Local OCR...");
        setStatusMsg("Verify OCR unavailable. Attempting Local OCR...");
        try {
          const page = await pdfDoc.getPage(currentPage);
          const tempCanvas = document.createElement('canvas');
          const ctx = tempCanvas.getContext('2d')!;
          const viewport = page.getViewport({ scale: 1.0 });
          tempCanvas.width = viewport.width;
          tempCanvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
          
          const text = await performTesseractOcrOnCanvas(tempCanvas, (msg) => setStatusMsg(`Local OCR: ${msg}`));
          const lines = text.split('\n').map(t => ({ text: t.trim(), y: 0 })).filter(l => l.text);
          const parsedRows = parseTesseractTextToStructuredData(lines);
          setTableData(assignUniqueRandomCodes([...tableData, ...parsedRows]));
          setStatusMsg(`Local OCR extracted ${parsedRows.length} rows.`);
        } catch (localErr) {
          // Last resort: Extract raw text lines for user
          console.error("Local OCR also failed, extracting raw text...");
          setStatusMsg("OCR unavailable. Extracting raw text for manual review...");
          try {
            const page = await pdfDoc.getPage(currentPage);
            const text = await page.getTextContent();
            const rawText = text.items.map((item: any) => item.str).join(' ');
            setStatusMsg(`📝 Raw text extracted: "${rawText.substring(0, 100)}...". Please review and edit manually.`);
          } catch (_) {
            setStatusMsg("⚠️ All OCR methods failed. Please try uploading a clearer image or PDF.");
          }
        }
      } else {
        setStatusMsg("Verify OCR Error: " + message);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunTesseractOcr = async (targetPages: 'current' | 'all' = 'current') => {
    if (!SHOW_LOCAL_OCR) return;
    const isImageDocument = Boolean(imageSourceRef.current && canvasRef.current);
    if (!pdfDoc && !isImageDocument) {
      setStatusMsg("Please upload a PDF or image invoice first.");
      return;
    }

    setIsProcessing(true);
    setTesseractProgress({ status: 'Loading Tesseract OCR engine...', progress: 0 });

    try {
      let combinedItems: any[] = [];
      let finalHeader = { ...docHeaderInfo };

      const pagesToProcess = pdfDoc && targetPages === 'all'
        ? Array.from({ length: totalPages }, (_, i) => i + 1)
        : [currentPage];

      for (const pageNum of pagesToProcess) {
        setTesseractProgress({ status: `Rendering Page ${pageNum}...`, progress: 0 });

        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d')!;
        if (pdfDoc) {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5, rotation: previewRotation });
          tempCanvas.width = viewport.width;
          tempCanvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
        } else if (canvasRef.current) {
          tempCanvas.width = canvasRef.current.width;
          tempCanvas.height = canvasRef.current.height;
          ctx.drawImage(canvasRef.current, 0, 0);
        }

        setTesseractProgress({ status: `OCR Page ${pageNum} - Initializing...`, progress: 0 });
        const rawText = await performTesseractOcrOnCanvas(tempCanvas, setTesseractProgress);

        if (rawText) {
          const parsed = parseTesseractTextToStructuredData(rawText, docHeaderInfo, applyAutoFill);

          if (parsed.header.supplier && !finalHeader.supplier) finalHeader.supplier = parsed.header.supplier;
          if (parsed.header.billNo && !finalHeader.billNo) finalHeader.billNo = parsed.header.billNo;
          if (parsed.header.date && !finalHeader.date) finalHeader.date = parsed.header.date;

          if (Array.isArray(parsed.items)) {
            combinedItems = [...combinedItems, ...parsed.items];
          }
        }
      }

      const normalizedRows = normalizeToErpRows(
        combinedItems,
        finalHeader,
        applyAutoFill,
        targetPages === 'all' ? 0 : tableData.length
      );

      if (normalizedRows.length > 0) {
        setTableData(assignUniqueRandomCodes(targetPages === 'all' ? normalizedRows : [...tableData, ...normalizedRows]));
        setDocHeaderInfo(finalHeader);
        setIsScannedPdf(false);
        setStatusMsg(`Extracted ${normalizedRows.length} items using Tesseract OCR!`);
      } else {
        setStatusMsg("Local OCR complete, but no items detected. Try Verify OCR for better accuracy.");
      }
    } catch (err) {
      console.error("Tesseract OCR Error:", err);
      setStatusMsg("Tesseract OCR Error: " + (err as Error).message);
    } finally {
      setIsProcessing(false);
      setTesseractProgress({ status: '', progress: 0 });
    }
  };

  useEffect(() => {
    if (pdfDoc && canvasRef.current) {
      renderPdfPageToCanvas(pdfDoc, currentPage, canvasRef.current, tableTopCutoff, tableBottomCutoff, previewRotation).catch(err => console.error("Canvas render error:", err));
    } else if (imageSourceRef.current) {
      drawImagePreview(imageSourceRef.current, previewRotation);
    }
  }, [pdfDoc, currentPage, previewRotation]);

  const handleSaveMetadata = () => {
    localStorage.setItem('invoice_metadata', JSON.stringify(docHeaderInfo));
    setTableData(prev => assignUniqueRandomCodes(prev.map(row => ({
      ...row,
      SUPPLIER: docHeaderInfo.supplier,
      "BILL NO.": docHeaderInfo.billNo,
      DATE: docHeaderInfo.date,
    }))));
    setStatusMsg('Saved. Supplier, Bill No. and Date updated in table rows.');
  };

  const handleExportExcel = () => {
    if (!tableData.length) {
      setStatusMsg('Export tab tak nahi hoga jab tak table me data na ho.');
      return;
    }
    const exportData = assignUniqueRandomCodes(tableData.map((row, idx) => {
      const updatedRow: ErpRow = {};
      ERP_COLUMNS.forEach(col => {
        updatedRow[col] = String(row[col] ?? '').replace(/[\r\n\t]+/g, ' ').trim();
      });
      if (!updatedRow["SUPPLIER"]) updatedRow["SUPPLIER"] = docHeaderInfo.supplier || '';
      if (!updatedRow["BILL NO."]) updatedRow["BILL NO."] = docHeaderInfo.billNo || '';
      if (!updatedRow["DATE"]) updatedRow["DATE"] = docHeaderInfo.date || '';
      updatedRow["ITEM NAME"] = String(updatedRow["ITEM NAME"] || '').replace(/\s+/g, ' ').trim();
      if (!updatedRow["PSRLNO"]) updatedRow["PSRLNO"] = String(idx + 1);
      return updatedRow;
    }));
    setTableData(exportData);

    const sheetRows = [
      ERP_COLUMNS,
      ...exportData.map(row => ERP_COLUMNS.map(col => {
        const value = row[col] || '';
        const isPlainNumeric = /^-?\d+(\.\d+)?$/.test(value);
        const hasLeadingZero = /^-?0\d/.test(value);
        if ((col === 'CODE' || ZERO_FILL_COLUMNS.includes(col)) && isPlainNumeric && !hasLeadingZero) {
          return Number(value);
        }
        return sanitizeForSpreadsheet(value);
      }))
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    worksheet['!cols'] = ERP_COLUMNS.map(col => ({
      wch: Math.max(col.length + 2, col === 'ITEM NAME' ? 36 : 12)
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    const fileName = `Clean_Invoice_${docHeaderInfo.billNo || 'Pharma'}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    setStatusMsg(`Exported ${fileName}`);
  };

const handleConvertPdfToCsv = async () => {
  if (!csvFile) {
    setCsvStatus('Please select a PDF file first.');
    return;
  }
  setIsCsvProcessing(true);
  setCsvContent('');
  setCsvStatus('Initializing...');

  try {
    setCsvStatus('Loading PDF...');
    const arrayBuffer = await csvFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allRawText: string[] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      setCsvStatus(`Processing page ${p} of ${pdf.numPages}...`);
      const page = await pdf.getPage(p);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const viewport = page.getViewport({ scale: 1.25 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;

      setCsvStatus(`Running OCR on page ${p} of ${pdf.numPages}...`);
      const rawText = await withRetry(() => 
        performGeminiVerbatimOcrOnCanvas(canvas, (msg) => 
       {   
           setCsvStatus(`Page ${p}: ${msg}`);
      }));

      if (rawText) {
        allRawText.push(rawText);
      }
    }

    if (allRawText.length === 0) {
      setCsvStatus('No text extracted from PDF.');
      setIsCsvProcessing(false);
      return;
    }

    setCsvStatus('Building CSV...');
    const Q = String.fromCharCode(34);
    const csvRows: string[] = [];

    for (const pageText of allRawText) {
      const lines = pageText.split('\n');
      for (const line of lines) {
        const safeLine = sanitizeForSpreadsheet(line);
        const escaped = safeLine.replace(new RegExp(Q, 'g'), Q + Q);
        csvRows.push(Q + escaped + Q);
      }
      csvRows.push(Q + '--- PAGE BREAK ---' + Q);
    }

    const csv = csvRows.join('\n');
    setCsvContent(csv);
    setCsvStatus(`Done. Extracted ${allRawText.length} page(s) with all text.`);
  } catch (err) {
    console.error('PDF to CSV Error:', err);
    setCsvStatus('Error: ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    setIsCsvProcessing(false);
  }
};
  
  
  const handleDownloadCsv = () => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `converted_${csvFile?.name.replace('.pdf', '') || 'document'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleAddRow = () => {
    const emptyRow: ErpRow = {};
    ERP_COLUMNS.forEach(c => emptyRow[c] = "");
    if (applyAutoFill) {
      emptyRow["SUPPLIER"] = docHeaderInfo.supplier;
      emptyRow["BILL NO."] = docHeaderInfo.billNo;
      emptyRow["DATE"] = docHeaderInfo.date;
      emptyRow["PSRLNO"] = String(tableData.length + 1);
    }
    setTableData(assignUniqueRandomCodes([...tableData, emptyRow]));
  };

  const handleClearTable = () => {
    if (!window.confirm('Clear table rows and invoice metadata (supplier, bill no, date)?')) return;
    setTableData([]);
    setDocHeaderInfo({ supplier: '', billNo: '', date: '' });
    try { localStorage.removeItem('invoice_metadata'); } catch (_) {}
    setStatusMsg('Table and invoice metadata cleared.');
  };

  const handleDeleteRow = (index: number) => {
    setTableData(tableData.filter((_, i) => i !== index));
  };

  const handleCellEdit = (rowIndex: number, colKey: string, value: string) => {
    const updated = [...tableData];
    updated[rowIndex] = { ...updated[rowIndex], [colKey]: value };
    setTableData(updated);
  };

  if (typeof window !== 'undefined' && window.location.hash === '#admin') {
    return <AdminPanel />;
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#f8fafc] text-slate-900">
        {sessionKickedOutMessage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4">
            <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-xl">
              <div className="mb-3 flex items-center gap-2 text-amber-700">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-lg font-bold">!</span>
                <h3 className="text-lg font-bold text-slate-900">Signed out</h3>
              </div>
              <p className="text-sm leading-6 text-slate-700">{sessionKickedOutMessage}</p>
              <button
                type="button"
                onClick={() => setSessionKickedOutMessage('')}
                className="mt-5 w-full rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700"
              >
                OK
              </button>
            </div>
          </div>
        )}
        <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-3">
              <img src={dwisLogo} alt="DWIS TAP" className="h-10 w-auto object-contain sm:h-14" />
            </div>

            <nav className="hidden flex-1 flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm font-medium text-slate-600 lg:flex">
              <a href="#how" className="transition hover:text-slate-900">How DWIS TAP works</a>
              <a href="#features" className="transition hover:text-slate-900">Features</a>
              <a href="#tools" className="transition hover:text-slate-900">Tools</a>
              <a href="#plans" className="transition hover:text-slate-900">Plans</a>
              <a href="#faq" className="transition hover:text-slate-900">FAQ</a>
              <a href="#support" className="transition hover:text-slate-900">Support</a>
              <a href="#auth" className="transition hover:text-slate-900">Account</a>
            </nav>

            <div className="hidden items-center gap-3 lg:flex">
              <button
                type="button"
                onClick={() => openAuth('login')}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Login
              </button>
              <a
                href={PRICING_CONTACT.href}
                className="rounded-full border border-[#1e86bb] px-4 py-2 text-sm font-semibold text-[#1e86bb] no-underline"
              >
                {PRICING_CONTACT.tel}
              </a>
              <button
                type="button"
                onClick={() => openAuth('register')}
                className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700"
              >
                Register
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsMobileNavOpen((prev) => !prev)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:bg-slate-50 lg:hidden"
              aria-label={isMobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileNavOpen}
            >
              {isMobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {isMobileNavOpen && (
            <div className="border-t border-slate-200 bg-white px-4 py-4 lg:hidden">
              <nav className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                <a href="#how" onClick={() => setIsMobileNavOpen(false)} className="rounded-lg px-2 py-2.5 transition hover:bg-slate-50">How DWIS TAP works</a>
                <a href="#features" onClick={() => setIsMobileNavOpen(false)} className="rounded-lg px-2 py-2.5 transition hover:bg-slate-50">Features</a>
                <a href="#tools" onClick={() => setIsMobileNavOpen(false)} className="rounded-lg px-2 py-2.5 transition hover:bg-slate-50">Tools</a>
                <a href="#plans" onClick={() => setIsMobileNavOpen(false)} className="rounded-lg px-2 py-2.5 transition hover:bg-slate-50">Plans</a>
                <a href="#faq" onClick={() => setIsMobileNavOpen(false)} className="rounded-lg px-2 py-2.5 transition hover:bg-slate-50">FAQ</a>
                <a href="#support" onClick={() => setIsMobileNavOpen(false)} className="rounded-lg px-2 py-2.5 transition hover:bg-slate-50">Support</a>
                <a href="#auth" onClick={() => setIsMobileNavOpen(false)} className="rounded-lg px-2 py-2.5 transition hover:bg-slate-50">Account</a>
              </nav>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => { setIsMobileNavOpen(false); openAuth('login'); }}
                  className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => { setIsMobileNavOpen(false); openAuth('register'); }}
                  className="w-full rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700"
                >
                  Register
                </button>
                <a
                  href={PRICING_CONTACT.href}
                  className="w-full rounded-full border border-[#1e86bb] px-4 py-2.5 text-center text-sm font-semibold text-[#1e86bb] no-underline"
                >
                  Call {PRICING_CONTACT.tel}
                </a>
              </div>
            </div>
          )}
        </header>

        <main>
          <section className="relative overflow-hidden bg-white">
            <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-blue-100/60 blur-3xl" aria-hidden="true" />
            <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full bg-blue-50 blur-3xl" aria-hidden="true" />
            <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-4 py-10 sm:gap-10 sm:px-6 sm:py-16 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
              <div>
                <div className="mb-4 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                  Invoice extractor
                </div>
                <h1 className="max-w-xl text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl sm:leading-tight lg:text-5xl">
                  Upload invoices. Extract. Export Excel.
                </h1>
                <p className="mt-4 max-w-xl text-base text-slate-600 sm:mt-5 sm:text-lg">
                  DWIS TAP turns bill PDFs and images into an editable 34-column ERP table — with preview cutoffs, metadata Save, OCR on the current page or all pages, then Excel export.
                </p>
                <div className="mt-8 grid grid-cols-2 gap-2.5 text-sm text-slate-600 sm:mt-10 sm:flex sm:flex-wrap sm:gap-4">
                  {landingStats.map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 sm:py-2">
                      <div className="text-lg font-bold text-slate-900 sm:text-xl">{item.value}</div>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div id="auth" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-card scroll-mt-24 sm:p-5">
                {pendingConfirmationEmail ? (
                  <div className="flex flex-col items-center py-3 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                      <Mail className="h-7 w-7" />
                    </div>
                    <h2 className="mt-4 text-xl font-black tracking-tight text-slate-900">Confirm your email to continue</h2>
                    <p className="mt-2 max-w-xs text-sm text-slate-600">
                      <span className="font-semibold text-slate-900">{pendingConfirmationEmail}</span> is not confirmed yet. Open the confirmation link we sent to that inbox, then come back here and log in.
                    </p>
                    <p className="mt-2 text-xs text-slate-400">Can't find it? Check your spam or promotions folder, or resend it below.</p>
                    {resendStatus && <p className="mt-3 text-xs font-medium text-blue-700">{resendStatus}</p>}
                    <div className="mt-5 flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center">
                      <div className="relative inline-flex">
                        <button
                          type="button"
                          onClick={handleResendConfirmation}
                          disabled={isResending || resendCooldown > 0}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isResending ? 'Resending…' : 'Resend confirmation email'}
                        </button>
                        {resendCooldown > 0 && (
                          <span className="absolute -top-2.5 -right-2.5 flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 shadow-sm animate-pulse">
                            <Clock className="h-3 w-3" />
                            {resendCooldown}s
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setPendingConfirmationEmail(''); setResendStatus(''); setAuthMode('login'); }}
                        className="rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700"
                      >
                        Back to Login
                      </button>
                    </div>
                    {resendCooldown > 0 && (
                      <p className="mt-2 text-[11px] text-slate-400">For security, you can resend again in {resendCooldown}s.</p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="mb-4 flex items-center gap-2">
                      <button type="button" onClick={() => setAuthMode('login')} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${authMode === 'login' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Login</button>
                      <button type="button" onClick={() => setAuthMode('register')} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${authMode === 'register' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Register</button>
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-slate-900">
                      {authMode === 'login' ? 'Login to TAP' : 'Create a TAP account'}
                    </h2>
                    <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                      {['Upload, preview cutoffs, metadata Save', 'Verify OCR — current page or all pages', '34-column ERP table, then Excel export'].map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                      One active session per account: signing in on another device or browser will sign you out here.
                      Do not share your login across multiple devices — repeated multi-device logins may lead to account suspension.
                    </p>
                    <form onSubmit={handleAuthSubmit} className="mt-4 space-y-3">
                      {authMode === 'register' && (
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">Full Name</label>
                          <input
                            value={authName}
                            onChange={(e) => setAuthName(e.target.value)}
                            className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                            placeholder="Your full name"
                            required={authMode === 'register'}
                          />
                        </div>
                      )}
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600">Email</label>
                        <input
                          type="email"
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                          placeholder="you@example.com"
                          required
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600">Password</label>
                        <input
                          type="password"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                          placeholder="••••••••"
                          required
                        />
                      </div>
                      {authError && <p className="text-xs text-red-600">{authError}</p>}
                      {authSuccess && <p className="text-xs text-emerald-600">{authSuccess}</p>}
                      <button type="submit" className="w-full rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700">
                        {authMode === 'login' ? 'Login to DWIS TAP' : 'Create account'}
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </section>

          <section id="how" className="scroll-mt-24 bg-slate-50 py-10 sm:py-14 text-slate-900">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="mx-auto max-w-2xl text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">How DWIS TAP works</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Upload, extract, export Excel.</h2>
              </div>
              <div className="mt-10 flex flex-col gap-5 md:flex-row md:items-stretch md:gap-3">
                {workflowSteps.map((step, index) => (
                  <Fragment key={step}>
                    <div className="flex-1 rounded-2xl border border-slate-200 bg-white p-5 transition duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg">
                      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                        {index + 1}
                      </div>
                      <p className="text-lg font-bold text-slate-900">{step}</p>
                      <p className="mt-2 text-sm text-slate-600">
                        {index === 0 && 'Upload a bill PDF or image, then set preview cutoffs if the page has extra header or footer text.'}
                        {index === 1 && 'Check supplier, bill number, date, and the 34-column table. Use OCR on this page or every page when needed.'}
                        {index === 2 && 'Save metadata into rows, then export Excel when the table has product lines.'}
                      </p>
                    </div>
                    {index < workflowSteps.length - 1 && (
                      <div className="hidden shrink-0 items-center justify-center text-slate-300 md:flex">
                        <ChevronRight className="h-6 w-6" />
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            </div>
          </section>

          <section id="features" className="scroll-mt-24 bg-white py-10 sm:py-14 text-slate-900">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="mx-auto max-w-2xl text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Features</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">DWIS TAP invoice tools.</h2>
              </div>
              <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {landingFeatures.map((feature) => (
                  <div key={feature.title} className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg">
                    <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${feature.accent} shadow-md transition group-hover:scale-105`}>
                      <feature.icon className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="tools" className="scroll-mt-24 bg-slate-50 py-10 sm:py-14 text-slate-900">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="mx-auto max-w-2xl text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Tools</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">What you use after login.</h2>
              </div>
              <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tapTools.map((item) => (
                  <div key={item.label} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-800 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
                    <item.icon className="h-4 w-4 shrink-0 text-blue-600" />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="plans" className="scroll-mt-24 bg-white py-10 sm:py-14 text-slate-900">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="mx-auto max-w-2xl text-center">
                <h2 className="text-3xl font-black tracking-tight text-slate-900">Plans</h2>
                <p className="mt-3 text-lg text-slate-600">Register for a 15-day trial. Paid plans via Contact us. When days or OCR pages end, the studio locks until the next plan is active.</p>
              </div>
              <div className="mt-8 flex justify-center">
                <div className="flex rounded-full border border-slate-200 bg-slate-100 p-1">
                  {(['trial', 'monthly', 'annually'] as PricingTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setPricingTab(tab)}
                      className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize ${pricingTab === tab ? 'bg-[#1e86bb] text-white' : 'text-slate-700'}`}
                    >
                      {tab === 'annually' ? 'Annually' : tab === 'trial' ? 'Trial' : 'Monthly'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {pricingTab === 'trial' && (
                  <TapPricingCard
                    badge="Trial"
                    title="Trial"
                    subtitle={`Free for ${TRIAL_DAYS} days`}
                    price={`₹0 · ${TRIAL_DAYS} days`}
                    howToGet={`Register on Account. After ${TRIAL_DAYS} days, Contact us. A bonus offer code adds ${TRIAL_DAYS} more days.`}
                    howToUse="Login → Upload bill → set cutoffs → Verify OCR (current page) → Save → Export Excel."
                    ocrNote="About 40 Verify OCR pages in the trial window."
                    includedCount={TAP_TIER_INCLUDED.basic}
                  />
                )}
                {pricingTab === 'monthly' && (
                  <>
                    <TapPricingCard
                      badge="Basic"
                      title="Monthly Basic"
                      subtitle="1 admin · incl. GST"
                      price={`₹${PLAN_PRICING.basic.monthly.toLocaleString('en-IN')} / month`}
                      howToGet="Contact us after trial. We activate Basic for 30 days."
                      howToUse="Same studio. Verify OCR on the page you are viewing."
                      ocrNote="About 100 Verify OCR pages / month. Limit end → studio locks until next plan."
                      includedCount={TAP_TIER_INCLUDED.basic}
                    />
                    <TapPricingCard
                      badge="Premium"
                      title="Monthly Premium"
                      subtitle="1 admin"
                      price={`₹${PLAN_PRICING.pro.monthly.toLocaleString('en-IN')} / month`}
                      howToGet="Contact us. We activate Premium for 30 days."
                      howToUse="Same studio plus Verify OCR on all pages of a multi-page PDF."
                      ocrNote="About 180 Verify OCR pages / month. Limit end → studio locks until next plan."
                      includedCount={TAP_TIER_INCLUDED.premium}
                    />
                  </>
                )}
                {pricingTab === 'annually' && (
                  <>
                    <TapPricingCard
                      badge="Basic"
                      title="Annual Basic"
                      subtitle="1 admin · 12 months"
                      price={`₹${PLAN_PRICING.basic.yearly.toLocaleString('en-IN')} / year`}
                      howToGet="Contact us. We activate Basic for 12 months."
                      howToUse="Same as Monthly Basic, billed yearly."
                      ocrNote="About 100 Verify OCR pages / month for 12 months."
                      includedCount={TAP_TIER_INCLUDED.basic}
                    />
                    <TapPricingCard
                      badge="Premium"
                      title="Annual Premium"
                      subtitle="1 admin · 12 months"
                      price={`₹${PLAN_PRICING.pro.yearly.toLocaleString('en-IN')} / year`}
                      howToGet="Contact us. We activate Premium for 12 months."
                      howToUse="Same as Monthly Premium, billed yearly."
                      ocrNote="About 180 Verify OCR pages / month for 12 months."
                      includedCount={TAP_TIER_INCLUDED.premium}
                    />
                  </>
                )}
              </div>
            </div>
          </section>

          <section id="faq" className="scroll-mt-24 bg-slate-50 py-10 sm:py-14 text-slate-900">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <div className="mx-auto max-w-2xl text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">FAQ</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">DWIS TAP questions.</h2>
              </div>
              <div className="mt-10 space-y-3">
                {tapFaqs.map((item, index) => {
                  const isOpen = openFaqIndex === index;
                  return (
                    <div key={item.question} className={`rounded-2xl border bg-white shadow-sm transition ${isOpen ? 'border-blue-200' : 'border-slate-200'}`}>
                      <button
                        type="button"
                        onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center justify-between gap-3 p-5 text-left"
                      >
                        <span className="text-base font-bold text-slate-900 sm:text-lg">{item.question}</span>
                        <ChevronDown className={`h-5 w-5 shrink-0 text-blue-600 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isOpen && (
                        <p className="px-5 pb-5 text-sm leading-6 text-slate-600">{item.answer}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section id="support" className="scroll-mt-24 bg-white py-10 sm:py-14 text-slate-900">
            <div className="mx-auto max-w-3xl px-4 sm:px-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Support</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">Need help with DWIS TAP?</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Ask about invoice upload, preview cutoffs, OCR pages, metadata Save, or Excel export.
                </p>
                <a href="mailto:support@dwistap.com" className="mt-5 inline-flex rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-cta hover:bg-blue-700">
                  support@dwistap.com
                </a>
              </div>
            </div>
          </section>
        </main>
        <footer className="border-t border-slate-200 bg-white py-10 text-slate-600">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <img src={dwisLogo} alt="DWIS TAP" className="h-9 w-auto object-contain" />
              <p className="mt-2 text-xs text-slate-500">Invoice extractor for PDF, OCR, 34-column ERP, and Excel.</p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <a href="#how" className="hover:text-blue-700">How DWIS TAP works</a>
              <a href="#features" className="hover:text-blue-700">Features</a>
              <a href="#tools" className="hover:text-blue-700">Tools</a>
              <a href="#plans" className="hover:text-blue-700">Plans</a>
              <a href="#faq" className="hover:text-blue-700">FAQ</a>
              <a href="#support" className="hover:text-blue-700">Support</a>
              <a href="#auth" className="hover:text-blue-700">Account</a>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  const accessBlock = getAccessBlockReason(session);
  if (accessBlock !== 'ok') {
    return (
      <div className="app-shell min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans">
        <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-md px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <img src={dwisLogo} alt="DWIS TAP" className="h-10 w-auto object-contain sm:h-12" />
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700">
              <span>{session.user.name}</span>
              {session.plan === 'trial' && (
                <button
                  type="button"
                  onClick={() => setShowPasscodeModal(true)}
                  className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 hover:bg-blue-100"
                >
                  Bonus offer
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
              >
                Logout
              </button>
            </div>
          </div>
        </header>
        <AccessPaywall
          session={session}
          reason={accessBlock}
          onLogout={handleLogout}
          onActivatePlan={handleActivatePlan}
          onRedeemPasscode={submitPasscode}
        />
        {showPasscodeModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <h3 className="text-lg font-bold text-slate-900">Bonus offer</h3>
              <p className="mt-1 text-sm text-slate-600">Enter a bonus offer code for one-time 15 extra days. Once it ends, pick a plan below to keep full access without interruption.</p>
              <input
                type="text"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Bonus offer code"
              />
              {passcodeMessage && <p className="mt-2 text-sm text-red-600">{passcodeMessage}</p>}
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={handlePasscodeSubmit} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Apply</button>
                <button type="button" onClick={() => setShowPasscodeModal(false)} className="rounded-full border border-slate-200 px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-md px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <img src={dwisLogo} alt="DWIS TAP" className="h-10 w-auto object-contain sm:h-12" />
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => window.location.reload()}
            className="header-btn-refresh flex items-center space-x-2 px-4 py-2 rounded-full text-xs font-semibold transition"
            title="Refresh page"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>

          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMasterMenu(!showMasterMenu); }}
              className="header-btn-upload flex items-center space-x-2 px-4 py-2 rounded-full text-xs font-semibold transition"
            >
              <Sparkles className="w-4 h-4" />
              <span>Upload</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showMasterMenu && (
              <UploadMenu
                show={showMasterMenu}
                selectedType={selectedUploadType}
                onSelectPdf={() => { fileInputRef.current?.click(); setShowMasterMenu(false); }}
                onSelectExcel={() => { setSelectedUploadType('excel'); excelInputRef.current?.click(); setShowMasterMenu(false); }}
                onSelectText={() => { setSelectedUploadType('text'); textInputRef.current?.click(); setShowMasterMenu(false); }}
                onSelectPdfToCsv={() => { setActiveView('csv'); setShowMasterMenu(false); }}
              />
            )}
          </div>

          {session ? (
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700">
              <span>{session.user.name}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAuthMode((prev) => prev === 'login' ? 'register' : 'login')}
              className="header-btn-upload flex items-center space-x-2 px-4 py-2 rounded-full text-xs font-semibold transition"
            >
              <Sparkles className="w-4 h-4" />
              <span>{authMode === 'login' ? 'Register' : 'Login'}</span>
            </button>
          )}


          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="application/pdf,image/*"
            className="hidden"
          />
          <input
            type="file"
            ref={excelInputRef}
            onChange={handleExcelUpload}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />
          <input
            type="file"
            ref={textInputRef}
            onChange={handleTextUpload}
            accept=".txt,.text"
            className="hidden"
          />

          {/* Top-bar Export — use Invoice Metadata Export instead
          <button
            onClick={handleExportExcel}
            className="flex items-center space-x-2 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition shadow-sm shadow-amber-600/20"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel (.xlsx)</span>
          </button>
          */}

          {/* PDF → CSV — hidden from main page
          <button
            onClick={() => setActiveView(activeView === 'csv' ? 'extractor' : 'csv')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-semibold transition shadow-sm ${
              activeView === 'csv'
                ? 'bg-amber-600 text-white shadow-amber-600/30'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
            }`}
          >
            <TableIcon className="w-4 h-4" />
            <span>{activeView === 'csv' ? 'Back to Extractor' : 'PDF → CSV'}</span>
          </button>
          */}
        </div>
        </div>
      </header>

      <div className="border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span className="flex min-w-0 max-w-full items-center gap-1.5 text-slate-700 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200 sm:max-w-xs">
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isProcessing ? 'animate-spin text-blue-600' : 'text-slate-400'}`} />
            <span className="truncate">{statusMsg}</span>
          </span>
          <span className="shrink-0 bg-blue-50 text-blue-800 border border-blue-100 px-2.5 py-1.5 rounded-full font-medium">
            {tableData.length} Product Rows
          </span>
          <span className="shrink-0 bg-white text-slate-700 border border-slate-200 px-2.5 py-1.5 rounded-full font-medium">
            Verify OCR: {session.ocrUsed} / {getVerifyOcrLimit(session.plan)} pages
          </span>
          <span className="shrink-0 bg-white text-slate-700 border border-slate-200 px-2.5 py-1.5 rounded-full font-medium">
            Plan: {session.plan} · {getDaysUntilExpiry(session.expiresAt)} day(s) left
          </span>
        </div>
        {(session.plan === 'trial' || (SHOW_PAYMENT_CHECKOUT && session.plan !== 'pro')) && (
          <button
            type="button"
            onClick={() => setShowPasscodeModal(true)}
            className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
          >
            Premium/Pro
          </button>
        )}
        {SHOW_RAW_PDF_TEXT_TAB && (
        <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('studio')}
            className={`flex items-center space-x-1.5 px-2 sm:px-3 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === 'studio' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>34-Col ERP Data Studio</span>
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === 'raw' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Raw PDF Text Data</span>
          </button>
        </div>
        )}
      </div>

      {showPlanExpiryWarning && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-amber-900">
              Your plan expires in {planDaysLeft} day(s).
            </p>
            <button type="button" onClick={() => setShowPasscodeModal(true)} className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500">Bonus offer</button>
          </div>
        </div>
      )}

      {showPasscodeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" style={{ maxHeight: '90vh' }}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Premium/Pro</h3>
              <button type="button" onClick={() => setShowPasscodeModal(false)} className="text-slate-500 hover:text-slate-700">✕</button>
            </div>
            <p className="text-sm font-bold text-slate-900">Bonus offer</p>
            <p className="mt-1 text-xs text-slate-600">Enter a bonus offer code for a one-time 15-day bonus. Once it ends, pick Basic or Premium to keep full access without interruption.</p>
            <input
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Enter bonus offer code"
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500"
            />
            {passcodeMessage && <p className="mt-2 text-xs text-blue-700">{passcodeMessage}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowPasscodeModal(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">Cancel</button>
              <button type="button" onClick={handlePasscodeSubmit} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500">Redeem bonus</button>
            </div>

            {SHOW_PAYMENT_CHECKOUT && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <p className="text-sm font-bold text-slate-900">Or pick a plan</p>
                <p className="mt-1 text-xs text-slate-600">Paid access gives you the plan's own days starting today — it does not add to your trial.</p>
                {(statusMsg.toLowerCase().includes('payment') || statusMsg.toLowerCase().includes('opening')) && (
                  <p className="mt-2 text-sm font-medium text-blue-700">{statusMsg}</p>
                )}
                <PlanCheckoutGrid onActivatePlan={handleActivatePlan} />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {activeView === 'csv' ? (
          <div className="flex-1 bg-slate-950 p-4 sm:p-6 overflow-y-auto flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-200">PDF to GST CSV Converter</h2>
                <p className="text-xs text-slate-400">Table extraction — preview columns before download</p>
              </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-6xl mx-auto w-full space-y-4">
              <div
                onClick={() => !csvFile && csvInputRef.current?.click()}
                className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-500 transition"
              >
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm text-slate-300">
                  {csvFile ? csvFile.name : 'Click to upload PDF file'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Any PDF invoice — table columns will be detected automatically</p>
              </div>

              <input
                type="file"
                ref={csvInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setCsvFile(file);
                  setCsvContent('');
                  setCsvStatus('');
                }}
                accept=".pdf"
                className="hidden"
              />

              <div className="flex flex-col sm:flex-row gap-2 sm:space-x-3">
                <button
                  onClick={handleConvertPdfToCsv}
                  disabled={!csvFile || isCsvProcessing}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
                >
                  {isCsvProcessing ? 'Converting...' : 'Convert to CSV'}
                </button>

                {csvContent && (
                  <button
                    onClick={handleDownloadCsv}
                    className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-lg text-sm font-semibold transition"
                  >
                    Download CSV
                  </button>
                )}
              </div>

              {csvStatus && (
                <p className="text-xs text-slate-300 bg-slate-900/60 p-2 rounded border border-slate-700">
                  {csvStatus}
                </p>
              )}

              {csvContent && (() => {
                const lines = csvContent.split('\n').filter(l => l.trim().length > 0);
                if (lines.length === 0) return null;
                const parseCsvLine = (line: string) => {
                  const result: string[] = [];
                  const regex = /(?:^|,)"((?:[^"]|"")*)"|(?:^|,)([^,]*)/g;
                  let m: RegExpExecArray | null;
                  while ((m = regex.exec(line)) !== null) {
                    result.push((m[1] || m[2] || '').replace(/""/g, '"'));
                  }
                  return result;
                };
                const headers = parseCsvLine(lines[0]);
                const dataRows = lines.slice(1).map(parseCsvLine);
                const maxCols = Math.max(headers.length, ...dataRows.map(r => r.length));
                const displayHeaders = headers.length ? headers : Array.from({ length: maxCols }, (_, i) => `Col ${i + 1}`);
                return (
                  <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-auto max-h-96">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-800 text-slate-300 sticky top-0">
                        <tr>
                          {displayHeaders.slice(0, maxCols).map((h, i) => (
                            <th key={i} className="px-3 py-2 border-b border-slate-700 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataRows.slice(0, 200).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-800/60">
                            {Array.from({ length: maxCols }).map((_, j) => (
                              <td key={j} className="px-3 py-1.5 border-b border-slate-700/50 text-slate-300 whitespace-nowrap">
                                {row[j] || ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {dataRows.length > 200 && (
                      <p className="text-xs text-slate-500 p-2">Showing first 200 rows of {dataRows.length}</p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : !SHOW_RAW_PDF_TEXT_TAB || activeTab === 'studio' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-3 pt-2 pb-2 space-y-2 shrink-0">
              <MetadataPanel
                header={docHeaderInfo}
                onChange={setDocHeaderInfo}
                onSave={handleSaveMetadata}
                onExport={handleExportExcel}
                canExport={tableData.length > 0}
              />
              {(pdfDoc || isScannedPdf) && (
                <div className="ocr-banner border rounded-xl px-3 py-2.5 flex flex-col gap-2 text-xs sm:flex-row sm:flex-wrap sm:items-center">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Scan className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    {totalPages > 1 ? `PDF has ${totalPages} pages — OCR any missing page:` : 'Scanned invoice — choose OCR:'}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                  {SHOW_LOCAL_OCR && (
                  <button
                    onClick={() => handleRunTesseractOcr('current')}
                    disabled={isProcessing}
                    className="ocr-btn ocr-btn-local py-2 px-3 rounded-full text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition disabled:opacity-50 sm:py-1.5"
                  >
                    <Scan className="w-3.5 h-3.5" />
                    <span>Local OCR (Current Page)</span>
                  </button>
                  )}
                  {SHOW_LOCAL_OCR && totalPages > 1 && (
                    <button
                      onClick={() => handleRunTesseractOcr('all')}
                      disabled={isProcessing}
                      className="ocr-btn ocr-btn-local py-2 px-3 rounded-full text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition disabled:opacity-50 sm:py-1.5"
                    >
                      <Scan className="w-3.5 h-3.5" />
                      <span>Local OCR (All Pages)</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleRunAiOcr('current')}
                    disabled={isProcessing || aiRateLimited}
                    className="ocr-btn ocr-btn-verify py-2 px-3 rounded-full text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition disabled:opacity-50 sm:py-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Verify OCR (Current Page)</span>
                  </button>
                  {session.plan === 'pro' && (
                  <button
                    onClick={() => handleRunAiOcr('all')}
                    disabled={isProcessing || aiRateLimited}
                    className="ocr-btn ocr-btn-all py-2 px-3 rounded-full text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition disabled:opacity-50 sm:py-1.5"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Verify OCR (All Pages)</span>
                  </button>
                  )}
                  </div>
                  {SHOW_LOCAL_OCR && tesseractProgress.status && (
                    <span className="flex items-center space-x-1.5 text-[11px]">
                      <RefreshCw className={`w-3 h-3 ${isProcessing ? 'animate-spin text-white' : ''}`} />
                      <span>{tesseractProgress.status}</span>
                    </span>
                  )}
                </div>
              )}
            </div>

          <div className="flex-1 flex flex-col md:flex-row md:items-start overflow-hidden min-h-0">

            <div
              className={
                isPreviewExpanded
                  ? `preview-panel has-split w-full md:flex-none self-start border-r border-slate-200 flex flex-col p-2 overflow-hidden min-w-0 h-auto ${(pdfDoc || isScannedPdf) ? 'has-doc max-h-[40vh] md:max-h-full' : ''}`
                  : 'hidden'
              }
              style={isPreviewExpanded ? { ['--preview-w']: `${previewWidth}px` } : undefined}
            >

              <div
                className={`preview-panel-card border border-slate-200 rounded-xl flex flex-col h-auto ${
                  isPreviewExpanded ? 'p-2' : 'p-0 border-0'
                }`}
              >
                {isPreviewExpanded && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs shrink-0 mb-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setIsPreviewExpanded(false)}
                    className="preview-toggle font-bold flex items-center gap-1 px-1 py-1 rounded min-w-0"
                  >
                    <Eye className="w-4 h-4 shrink-0" />
                    <span className="truncate">Visual Page Preview</span>
                    <ChevronDown className="w-3.5 h-3.5 rotate-180 shrink-0" />
                  </button>
                  {pdfDoc && (
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        onClick={() => { setCurrentPage(Math.max(1, currentPage - 1)); setPreviewRotation(0); }}
                        disabled={currentPage <= 1}
                        className="preview-toggle p-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="preview-toggle whitespace-nowrap">{currentPage} / {totalPages}</span>
                      <button
                        onClick={() => { setCurrentPage(Math.min(totalPages, currentPage + 1)); setPreviewRotation(0); }}
                        disabled={currentPage >= totalPages}
                        className="preview-toggle p-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {(pdfDoc || imageSourceRef.current) && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPreviewZoom((z) => Math.max(0.6, Math.round((z - 0.15) * 100) / 100))}
                        className="preview-toggle p-1 rounded bg-slate-700 hover:bg-slate-600"
                        title="Zoom out"
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span className="preview-toggle w-9 text-center tabular-nums">{Math.round(previewZoom * 100)}%</span>
                      <button
                        type="button"
                        onClick={() => setPreviewZoom((z) => Math.min(2, Math.round((z + 0.15) * 100) / 100))}
                        className="preview-toggle p-1 rounded bg-slate-700 hover:bg-slate-600"
                        title="Zoom in"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => rotatePreview(-90)}
                        disabled={isProcessing}
                        className="preview-toggle p-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                        title="Rotate preview left"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => rotatePreview(90)}
                        disabled={isProcessing}
                        className="preview-toggle p-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                        title="Rotate preview right"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                )}

                <div
                  onClick={() => !pdfDoc && !isScannedPdf && fileInputRef.current?.click()}
                  className={`${isPreviewExpanded ? 'w-full min-w-0' : 'hidden'} preview-stage rounded-lg border border-slate-200 cursor-pointer group ${(pdfDoc || isScannedPdf) ? 'max-h-[calc(100vh-14rem)] overflow-auto' : ''}`}
                >
                  {(pdfDoc || isScannedPdf) ? (
                    <div ref={previewWrapRef} className="relative w-full bg-white">
                      <canvas
                        ref={canvasRef}
                        className="preview-canvas h-auto rounded"
                        style={{ width: `${previewZoom * 100}%` }}
                      />
                      <button
                        type="button"
                        className="cutoff-line cutoff-line-top"
                        style={{ top: `${tableTopCutoff}%` }}
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); cutoffDragRef.current = 'top'; }}
                        title="Drag to set table start (header above this line)"
                      >
                        <span className="cutoff-label">Header above · Table below</span>
                      </button>
                      <button
                        type="button"
                        className="cutoff-line cutoff-line-bottom"
                        style={{ top: `${tableBottomCutoff}%` }}
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); cutoffDragRef.current = 'bottom'; }}
                        title="Drag to set table end"
                      >
                        <span className="cutoff-label">Table end</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <canvas ref={canvasRef} className="preview-canvas-idle" width={1} height={1} />
                      <div className="preview-dropzone w-full min-w-0 p-4 text-center bg-white">
                        <div className="p-2.5 border border-slate-200 rounded-full w-10 h-10 mx-auto flex items-center justify-center mb-2 bg-white">
                          <Upload className="w-5 h-5 text-slate-500" />
                        </div>
                        <p className="font-semibold text-slate-800 text-xs break-words">Click or drop invoice here</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 break-words">PDF, JPG, PNG</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

            </div>

            {isPreviewExpanded && (
              <div
                className="preview-splitter hidden md:block"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  splitDragRef.current = true;
                  splitStartRef.current = { x: e.clientX, w: previewWidth };
                }}
                title="Drag to resize preview"
              />
            )}

            <div className="flex-1 min-w-0 min-h-0 self-stretch bg-slate-950 flex flex-col overflow-hidden">

              <div className="bg-slate-800/90 border-b border-slate-700/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {!isPreviewExpanded && (
                    <button
                      type="button"
                      onClick={() => setIsPreviewExpanded(true)}
                      className="preview-toggle flex items-center space-x-1 bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded-md text-[11px] font-semibold transition"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Show Preview</span>
                    </button>
                  )}
                  <button
                    onClick={handleAddRow}
                    className="flex items-center space-x-1 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Row</span>
                  </button>
                  <button
                    onClick={handleClearTable}
                    disabled={tableData.length === 0 && !docHeaderInfo.supplier && !docHeaderInfo.billNo && !docHeaderInfo.date}
                    className="flex items-center space-x-1 bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Table</span>
                  </button>
                </div>

                {SHOW_AUTO_FILL_HEADER && (
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-400">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoFillHeaderInfo}
                      onChange={(e) => setAutoFillHeaderInfo(e.target.checked)}
                      className="rounded bg-slate-900 border border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Auto-Fill Header Meta into Rows</span>
                  </label>
                </div>
                )}
              </div>

              <StudioTable
                data={tableData}
                onAddRow={handleAddRow}
                onDeleteRow={handleDeleteRow}
                onCellEdit={handleCellEdit}
              />

            </div>

          </div>
          </div>
        ) : (
          <div className="flex-1 bg-slate-950 p-4 sm:p-6 overflow-y-auto flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-200">Raw PDF Text Line Inspection</h2>
                <p className="text-xs text-slate-400">View line-by-line text tokens extracted directly from PDF.js spatial coordinates</p>
              </div>
              <div className="relative w-full sm:w-64">
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

            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-auto p-3 sm:p-3 sm:p-4 font-mono text-xs space-y-1">
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

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        <img src={dwisLogo} alt="DWIS TAP" className="mx-auto mb-2 h-7 w-auto object-contain" />
        Invoice extractor · Upload, OCR, 34-column ERP, Excel export
      </footer>
    </div>
  );
}
