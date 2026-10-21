// @ts-nocheck
import { useState, useEffect } from 'react';
import { ShieldCheck, Search, User, Users, Ticket, Menu, X as CloseIcon, CreditCard, LogOut, IndianRupee, TrendingUp, AlertCircle, Bell, UserPlus, Clock, MessageCircle, Send, Download, History } from 'lucide-react';
import { apiUrl } from '../utils/apiBase';
import { DAILY_OCR_PAGE_LIMITS, type PlanId } from '../utils/auth';

const ADMIN_TOKEN_KEY = 'dwis_admin_token';

const todayKey = () => new Date().toISOString().slice(0, 10);

// Mirrors getOcrUsedToday() in utils/auth.ts - a stale day key means 0 used today.
const usedToday = (u: { ocr_used_today: number; ocr_day_key: string }) =>
  u.ocr_day_key === todayKey() ? u.ocr_used_today : 0;

interface LookedUpUser {
  user_id: string;
  email: string;
  name: string;
  plan: string;
  billing_cycle: string;
  expires_at: string;
  ocr_used: number;
  ocr_period_key: string;
  ocr_used_today: number;
  ocr_day_key: string;
}

interface ListedUser extends LookedUpUser {
  created_at: string;
}

interface PaymentRecord {
  id: number;
  plan: string;
  billing_cycle: string;
  amount_paise: number;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  source: 'razorpay' | 'cash' | 'coupon';
  note: string | null;
  created_at: string;
}

const SOURCE_LABEL: Record<string, string> = {
  razorpay: 'Razorpay',
  cash: 'Cash',
  coupon: 'Coupon',
};

interface GlobalPaymentRecord {
  id: number;
  user_id: string;
  email: string;
  name: string;
  plan: string;
  billing_cycle: string;
  amount_paise: number;
  status: 'pending' | 'success' | 'failed';
  failure_reason: string | null;
  source: 'razorpay' | 'cash' | 'coupon';
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  note: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  success: { label: 'Success', className: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700' },
};

interface DiscountCoupon {
  code: string;
  discount_percent: number;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  times_redeemed: number;
}

type AdminTab = 'users' | 'payments' | 'coupons' | 'find' | 'chat' | 'analytics' | 'activity' | 'profile';

const NAV_ITEMS: { key: AdminTab; label: string; icon: typeof Users }[] = [
  { key: 'users', label: 'Registered users', icon: Users },
  { key: 'payments', label: 'All payments', icon: CreditCard },
  { key: 'coupons', label: 'Discount coupons', icon: Ticket },
  { key: 'find', label: 'Find a user', icon: Search },
  { key: 'chat', label: 'Support chat', icon: MessageCircle },
  { key: 'analytics', label: 'Analytics', icon: TrendingUp },
  { key: 'activity', label: 'Activity log', icon: Clock },
  { key: 'profile', label: 'Admin profile', icon: ShieldCheck },
];

// Minimal CSV export - escapes quotes/commas, triggers a browser download.
// No backend needed: the admin panel already has every row loaded client-side.
function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Fixed categorical + status hues (never reassigned/cycled) - see dataviz skill.
const PLAN_COLOR: Record<string, string> = { trial: '#2a78d6', basic: '#eb6834', pro: '#1baf7a' };
const STATUS_COLOR: Record<string, string> = { success: '#0ca30c', failed: '#d03b3b', pending: '#fab219' };

const last14Days = () => {
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
};

const EXPIRY_WARNING_DAYS = 4;
const NEW_SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const daysUntil = (expiresAt: string) => {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
};

export default function AdminPanel() {
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; }
  });
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [searchEmail, setSearchEmail] = useState('');
  const [foundUser, setFoundUser] = useState<LookedUpUser | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [lookupError, setLookupError] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const [grantDays, setGrantDays] = useState('15');
  const [grantPlan, setGrantPlan] = useState<'trial' | 'basic' | 'pro'>('trial');
  const [grantAmount, setGrantAmount] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [grantMessage, setGrantMessage] = useState('');
  const [isGranting, setIsGranting] = useState(false);
  const [isExpiring, setIsExpiring] = useState(false);

  const [allUsers, setAllUsers] = useState<ListedUser[]>([]);
  const [listSearch, setListSearch] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [listError, setListError] = useState('');
  const [userPlanFilter, setUserPlanFilter] = useState<'all' | 'trial' | 'basic' | 'pro'>('all');

  const [allPayments, setAllPayments] = useState<GlobalPaymentRecord[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [paymentsError, setPaymentsError] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'success' | 'failed' | 'pending'>('all');
  const [paymentFromDate, setPaymentFromDate] = useState('');
  const [paymentToDate, setPaymentToDate] = useState('');

  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState('');

  const [coupons, setCoupons] = useState<DiscountCoupon[]>([]);
  const [isLoadingCoupons, setIsLoadingCoupons] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponPercent, setNewCouponPercent] = useState('10');
  const [newCouponExpiry, setNewCouponExpiry] = useState('');
  const [isCreatingCoupon, setIsCreatingCoupon] = useState(false);
  const [showTrialCodes, setShowTrialCodes] = useState(false);

  const [conversations, setConversations] = useState<any[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [chatError, setChatError] = useState('');
  const [activeChatUserId, setActiveChatUserId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);

  const authHeader = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

  const fetchAllPayments = async () => {
    if (!token) return;
    setIsLoadingPayments(true);
    setPaymentsError('');
    try {
      const res = await fetch(apiUrl('/api/admin-payments'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({}),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load payments.');
      setAllPayments(data.payments || []);
    } catch (error: any) {
      setPaymentsError(error?.message || 'Could not load payments.');
    } finally {
      setIsLoadingPayments(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchAllPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchCoupons = async () => {
    if (!token) return;
    setIsLoadingCoupons(true);
    setCouponError('');
    try {
      const res = await fetch(apiUrl('/api/admin-coupons'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'list' }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load coupons.');
      setCoupons(data.coupons || []);
    } catch (error: any) {
      setCouponError(error?.message || 'Could not load coupons.');
    } finally {
      setIsLoadingCoupons(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchCoupons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchAuditLog = async () => {
    if (!token) return;
    setIsLoadingAudit(true);
    setAuditError('');
    try {
      const res = await fetch(apiUrl('/api/admin-audit'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({}),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load activity log.');
      setAuditEntries(data.entries || []);
    } catch (error: any) {
      setAuditError(error?.message || 'Could not load activity log.');
    } finally {
      setIsLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (!token || activeTab !== 'activity') return;
    fetchAuditLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab]);

  const fetchConversations = async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/admin-chat'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'conversations' }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load conversations.');
      setConversations(data.conversations || []);
    } catch (error: any) {
      setChatError(error?.message || 'Could not load conversations.');
    } finally {
      setIsLoadingConversations(false);
    }
  };

  useEffect(() => {
    if (!token || activeTab !== 'chat') return;
    setIsLoadingConversations(true);
    fetchConversations();
    const timer = setInterval(fetchConversations, 6000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab]);

  const fetchChatMessages = async (userId: string) => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/admin-chat'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'messages', userId }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load messages.');
      setChatMessages(data.messages || []);
    } catch (error: any) {
      setChatError(error?.message || 'Could not load messages.');
    }
  };

  useEffect(() => {
    if (!token || !activeChatUserId) return;
    fetchChatMessages(activeChatUserId);
    const timer = setInterval(() => fetchChatMessages(activeChatUserId), 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeChatUserId]);

  const handleOpenChat = (userId: string) => {
    setActiveChatUserId(userId);
    setChatMessages([]);
  };

  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || !activeChatUserId) return;
    setIsSendingChat(true);
    setChatError('');
    try {
      const res = await fetch(apiUrl('/api/admin-chat'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'send', userId: activeChatUserId, body: text }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send message.');
      setChatInput('');
      fetchChatMessages(activeChatUserId);
      fetchConversations();
    } catch (error: any) {
      setChatError(error?.message || 'Could not send message.');
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleCreateCoupon = async () => {
    const percent = Number(newCouponPercent);
    if (!newCouponCode.trim() || !Number.isFinite(percent) || percent < 1 || percent > 100) {
      setCouponError('Enter a code and a discount percent between 1 and 100.');
      return;
    }
    setIsCreatingCoupon(true);
    setCouponError('');
    try {
      const res = await fetch(apiUrl('/api/admin-coupons'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          action: 'create',
          code: newCouponCode.trim(),
          discountPercent: percent,
          expiresAt: newCouponExpiry ? new Date(newCouponExpiry).toISOString() : null,
        }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create coupon.');
      setNewCouponCode('');
      setNewCouponPercent('10');
      setNewCouponExpiry('');
      fetchCoupons();
    } catch (error: any) {
      setCouponError(error?.message || 'Could not create coupon.');
    } finally {
      setIsCreatingCoupon(false);
    }
  };

  const handleToggleCoupon = async (code: string, active: boolean) => {
    setCouponError('');
    try {
      const res = await fetch(apiUrl('/api/admin-coupons'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action: 'toggle', code, active }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update coupon.');
      fetchCoupons();
    } catch (error: any) {
      setCouponError(error?.message || 'Could not update coupon.');
    }
  };

  const fetchUsers = async (search: string) => {
    if (!token) return;
    setIsLoadingUsers(true);
    setListError('');
    try {
      const res = await fetch(apiUrl('/api/admin-users'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ search: search.trim() || undefined }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load users.');
      setAllUsers(data.users || []);
    } catch (error: any) {
      setListError(error?.message || 'Could not load users.');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => fetchUsers(listSearch), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, listSearch]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const res = await fetch(apiUrl('/api/admin-login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setToken(data.token);
      setPasscodeInput('');
    } catch (error: any) {
      setLoginError(error?.message || 'Login failed.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken(null);
    setFoundUser(null);
  };

  const handleUnauthorized = () => {
    handleLogout();
    setLoginError('Session expired. Please log in again.');
  };

  const loadUserDetail = async (email: string) => {
    if (!email.trim()) return;
    setLookupError('');
    setGrantMessage('');
    setFoundUser(null);
    setPayments([]);
    setIsSearching(true);
    try {
      const res = await fetch(apiUrl('/api/admin-lookup'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'User not found.');
      setFoundUser(data.user);
      setGrantPlan(data.user.plan);
      setPayments(data.payments || []);
    } catch (error: any) {
      setLookupError(error?.message || 'User not found.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadUserDetail(searchEmail);
  };

  const handleSelectFromList = (email: string) => {
    setSearchEmail(email);
    loadUserDetail(email);
    setActiveTab('find');
    setMenuOpen(false);
  };

  const handleGrant = async () => {
    if (!foundUser) return;
    const days = Number(grantDays);
    if (!Number.isFinite(days) || days <= 0) {
      setGrantMessage('Enter a valid number of days.');
      return;
    }
    setIsGranting(true);
    setGrantMessage('');
    try {
      const res = await fetch(apiUrl('/api/admin-grant'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ email: foundUser.email, days, plan: grantPlan, amount: grantAmount || undefined, note: grantNote || undefined }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not grant access.');
      setFoundUser((prev) => prev ? { ...prev, plan: data.entitlement.plan, expires_at: data.entitlement.expires_at } : prev);
      setGrantMessage(`Done. ${foundUser.email} now has ${data.entitlement.plan} until ${new Date(data.entitlement.expires_at).toLocaleString('en-IN')}.`);
      setGrantAmount('');
      setGrantNote('');
      // Re-fetch so the new cash payment (if any) shows up in the history table below.
      if (grantAmount) {
        const paymentsRes = await fetch(apiUrl('/api/admin-lookup'), {
          method: 'POST',
          headers: authHeader(),
          body: JSON.stringify({ email: foundUser.email }),
        });
        const paymentsData = await paymentsRes.json();
        if (paymentsRes.ok) setPayments(paymentsData.payments || []);
      }
      fetchUsers(listSearch);
    } catch (error: any) {
      setGrantMessage(error?.message || 'Could not grant access.');
    } finally {
      setIsGranting(false);
    }
  };

  const handleExpireNow = async () => {
    if (!foundUser) return;
    if (!window.confirm(`Expire access for ${foundUser.email} right now? Studio will lock for them immediately.`)) return;
    setIsExpiring(true);
    setGrantMessage('');
    try {
      const res = await fetch(apiUrl('/api/admin-expire'), {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ email: foundUser.email }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not expire access.');
      setFoundUser((prev) => prev ? { ...prev, expires_at: data.entitlement.expires_at } : prev);
      setGrantMessage(`Done. ${foundUser.email}'s access is expired as of now.`);
      fetchUsers(listSearch);
    } catch (error: any) {
      setGrantMessage(error?.message || 'Could not expire access.');
    } finally {
      setIsExpiring(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-7 shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/30">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <p className="mt-4 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-blue-700">DWIS TAP Admin</p>
          <h1 className="mt-1 text-center text-xl font-black text-slate-900">Welcome back</h1>
          <p className="mt-1 text-center text-sm text-slate-500">Enter the admin passcode to continue.</p>
          <input
            type="password"
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            placeholder="Admin passcode"
            className="mt-5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:bg-white"
            required
            autoFocus
          />
          {loginError && (
            <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {loginError}
            </p>
          )}
          <button
            type="submit"
            disabled={isLoggingIn}
            className="mt-4 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoggingIn ? 'Checking…' : 'Enter dashboard'}
          </button>
        </form>
      </div>
    );
  }

  const revenueTotal = allPayments.filter((p) => p.status === 'success').reduce((sum, p) => sum + p.amount_paise, 0) / 100;
  const failedCount = allPayments.filter((p) => p.status === 'failed').length;
  const paidPlansCount = allUsers.filter((u) => u.plan !== 'trial').length;

  const newSignups = allUsers
    .filter((u) => Date.now() - new Date(u.created_at).getTime() <= NEW_SIGNUP_WINDOW_MS)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const expiringSoon = allUsers
    .filter((u) => { const d = daysUntil(u.expires_at); return d > 0 && d <= EXPIRY_WARNING_DAYS; })
    .sort((a, b) => daysUntil(a.expires_at) - daysUntil(b.expires_at));
  const recentFailedPayments = allPayments
    .filter((p) => p.status === 'failed' && Date.now() - new Date(p.created_at).getTime() <= NEW_SIGNUP_WINDOW_MS)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const notifCount = newSignups.length + expiringSoon.length + recentFailedPayments.length;

  const days14 = last14Days();
  const revenueByDay = days14.map((day) => ({
    day,
    amount: allPayments
      .filter((p) => p.status === 'success' && p.created_at.slice(0, 10) === day)
      .reduce((sum, p) => sum + p.amount_paise, 0) / 100,
  }));
  const maxDailyRevenue = Math.max(1, ...revenueByDay.map((d) => d.amount));

  const signupsByDay = days14.map((day) => ({
    day,
    count: allUsers.filter((u) => u.created_at.slice(0, 10) === day).length,
  }));
  const maxDailySignups = Math.max(1, ...signupsByDay.map((d) => d.count));

  const planCounts = ['trial', 'basic', 'pro'].map((plan) => ({
    plan,
    count: allUsers.filter((u) => u.plan === plan).length,
  }));
  const maxPlanCount = Math.max(1, ...planCounts.map((p) => p.count));

  const statusCounts = (['success', 'failed', 'pending'] as const).map((status) => ({
    status,
    count: allPayments.filter((p) => p.status === status).length,
  }));
  const maxStatusCount = Math.max(1, ...statusCounts.map((s) => s.count));

  const KPI_CARDS = [
    { label: 'Total users', value: allUsers.length.toLocaleString('en-IN'), icon: Users, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
    { label: 'Paid plans', value: paidPlansCount.toLocaleString('en-IN'), icon: TrendingUp, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
    { label: 'Revenue (success)', value: `₹${revenueTotal.toLocaleString('en-IN')}`, icon: IndianRupee, iconBg: 'bg-indigo-50', iconColor: 'text-indigo-600' },
    { label: 'Failed payments', value: failedCount.toLocaleString('en-IN'), icon: AlertCircle, iconBg: 'bg-rose-50', iconColor: 'text-rose-600' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-black leading-tight text-slate-900">DWIS TAP</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">Admin</p>
          </div>
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Logout
        </button>
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => setMenuOpen((v) => !v)} className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-700" aria-label="Menu">
            {menuOpen ? <CloseIcon className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            <p className="text-xs font-bold uppercase tracking-[0.14em]">DWIS TAP Admin</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setNotifOpen((v) => !v)} className="relative rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-700" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              {notifCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                  <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Notifications</p>
                  <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                    {notifCount === 0 && <p className="px-1 py-3 text-center text-xs text-slate-400">Nothing new right now.</p>}
                    {newSignups.map((u) => (
                      <button key={`m-signup-${u.user_id}`} type="button" onClick={() => { handleSelectFromList(u.email); setNotifOpen(false); }} className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50">
                        <UserPlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="text-xs text-slate-700"><span className="font-semibold text-slate-900">{u.name || u.email}</span> just signed up</span>
                      </button>
                    ))}
                    {expiringSoon.map((u) => (
                      <button key={`m-expiring-${u.user_id}`} type="button" onClick={() => { handleSelectFromList(u.email); setNotifOpen(false); }} className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50">
                        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span className="text-xs text-slate-700"><span className="font-semibold text-slate-900">{u.name || u.email}</span>'s {u.plan} plan ends in {daysUntil(u.expires_at)}d</span>
                      </button>
                    ))}
                    {recentFailedPayments.map((p) => (
                      <button key={`m-failed-${p.id}`} type="button" onClick={() => { handleSelectFromList(p.email); setNotifOpen(false); }} className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                        <span className="text-xs text-slate-700"><span className="font-semibold text-slate-900">{p.name || p.email}</span>'s payment of ₹{(p.amount_paise / 100).toLocaleString('en-IN')} failed</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={handleLogout} className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-700" aria-label="Logout">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 bg-white p-4 shadow-2xl">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => { setActiveTab(item.key); setMenuOpen(false); }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium ${
                    activeTab === item.key ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 hidden items-center justify-between lg:flex">
            <h1 className="text-lg font-bold text-slate-900">Dashboard</h1>
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative rounded-full border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm transition hover:bg-slate-50"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {notifCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                    <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Notifications</p>
                    <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
                      {notifCount === 0 && (
                        <p className="px-1 py-3 text-center text-xs text-slate-400">Nothing new right now.</p>
                      )}
                      {newSignups.map((u) => (
                        <button
                          key={`signup-${u.user_id}`}
                          type="button"
                          onClick={() => { handleSelectFromList(u.email); setNotifOpen(false); }}
                          className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50"
                        >
                          <UserPlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span className="text-xs text-slate-700">
                            <span className="font-semibold text-slate-900">{u.name || u.email}</span> just signed up
                            <span className="block text-[10px] text-slate-400">{new Date(u.created_at).toLocaleString('en-IN')}</span>
                          </span>
                        </button>
                      ))}
                      {expiringSoon.map((u) => (
                        <button
                          key={`expiring-${u.user_id}`}
                          type="button"
                          onClick={() => { handleSelectFromList(u.email); setNotifOpen(false); }}
                          className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50"
                        >
                          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <span className="text-xs text-slate-700">
                            <span className="font-semibold text-slate-900">{u.name || u.email}</span>'s {u.plan} plan ends in {daysUntil(u.expires_at)} day(s)
                          </span>
                        </button>
                      ))}
                      {recentFailedPayments.map((p) => (
                        <button
                          key={`failed-${p.id}`}
                          type="button"
                          onClick={() => { handleSelectFromList(p.email); setNotifOpen(false); }}
                          className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50"
                        >
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                          <span className="text-xs text-slate-700">
                            <span className="font-semibold text-slate-900">{p.name || p.email}</span>'s payment of ₹{(p.amount_paise / 100).toLocaleString('en-IN')} failed
                            <span className="block text-[10px] text-slate-400">{new Date(p.created_at).toLocaleString('en-IN')}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {KPI_CARDS.map((kpi) => {
              const Icon = kpi.icon;
              return (
                <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${kpi.iconBg}`}>
                    <Icon className={`h-5 w-5 ${kpi.iconColor}`} />
                  </div>
                  <p className="mt-3 text-xl font-bold text-slate-900">{kpi.value}</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">{kpi.label}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-5 hidden gap-2 sm:flex">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition ${
                    activeTab === item.key ? 'bg-slate-900 text-white shadow-md' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

        {activeTab === 'users' && (
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-900">Registered users</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400">{isLoadingUsers ? 'Loading…' : `${allUsers.length} shown`}</span>
              <button
                type="button"
                onClick={() => downloadCsv(`users-${todayKey()}.csv`, allUsers.map((u) => ({
                  name: u.name, email: u.email, plan: u.plan, billing_cycle: u.billing_cycle,
                  expires_at: u.expires_at, ocr_used: u.ocr_used, created_at: u.created_at,
                })))}
                disabled={allUsers.length === 0}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <Download className="h-3 w-3" /> CSV
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="flex-1 min-w-[160px] rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
            {(['all', 'trial', 'basic', 'pro'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setUserPlanFilter(p)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold capitalize ${
                  userPlanFilter === p ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          {listError && <p className="mt-2 text-xs text-red-600">{listError}</p>}
          <div className="mt-3 max-h-80 overflow-y-auto overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Plan</th>
                  <th className="px-3 py-2 font-semibold">Expires</th>
                  <th className="px-3 py-2 font-semibold">OCR used</th>
                  <th className="px-3 py-2 font-semibold">Today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(() => {
                  const filteredUsers = userPlanFilter === 'all' ? allUsers : allUsers.filter((u) => u.plan === userPlanFilter);
                  if (filteredUsers.length === 0 && !isLoadingUsers) {
                    return <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No users found.</td></tr>;
                  }
                  return filteredUsers.map((u) => (
                  <tr
                    key={u.user_id}
                    onClick={() => handleSelectFromList(u.email)}
                    className={`cursor-pointer hover:bg-blue-50 ${foundUser?.user_id === u.user_id ? 'bg-blue-50' : ''}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{u.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{u.email}</td>
                    <td className="px-3 py-2 text-slate-700">{u.plan}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{new Date(u.expires_at).toLocaleDateString('en-IN')}</td>
                    <td className="px-3 py-2 text-slate-700">{u.ocr_used}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                      {usedToday(u)} / {DAILY_OCR_PAGE_LIMITS[u.plan as PlanId] ?? '—'}
                    </td>
                  </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'payments' && (
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-slate-900">All payments</h2>
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'success', 'failed', 'pending'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPaymentStatusFilter(s)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${
                    paymentStatusFilter === s ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </button>
              ))}
              <input type="date" value={paymentFromDate} onChange={(e) => setPaymentFromDate(e.target.value)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-700 outline-none focus:border-blue-500" />
              <span className="text-[11px] text-slate-400">to</span>
              <input type="date" value={paymentToDate} onChange={(e) => setPaymentToDate(e.target.value)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-700 outline-none focus:border-blue-500" />
              <button
                type="button"
                onClick={() => {
                  const rows = allPayments.filter((p) => {
                    if (paymentStatusFilter !== 'all' && p.status !== paymentStatusFilter) return false;
                    const day = p.created_at.slice(0, 10);
                    if (paymentFromDate && day < paymentFromDate) return false;
                    if (paymentToDate && day > paymentToDate) return false;
                    return true;
                  });
                  downloadCsv(`payments-${todayKey()}.csv`, rows.map((p) => ({
                    date: p.created_at, name: p.name, email: p.email, plan: p.plan, billing_cycle: p.billing_cycle,
                    amount_inr: p.amount_paise / 100, status: p.status, source: p.source,
                    razorpay_payment_id: p.razorpay_payment_id, note: p.note,
                  })));
                }}
                disabled={allPayments.length === 0}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <Download className="h-3 w-3" /> CSV
              </button>
            </div>
          </div>
          {paymentsError && <p className="mt-2 text-xs text-red-600">{paymentsError}</p>}
          <div className="mt-3 max-h-80 overflow-y-auto overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">User</th>
                  <th className="px-3 py-2 font-semibold">Plan</th>
                  <th className="px-3 py-2 font-semibold">Amount</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Reference / Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(() => {
                  const rows = allPayments.filter((p) => {
                    if (paymentStatusFilter !== 'all' && p.status !== paymentStatusFilter) return false;
                    const day = p.created_at.slice(0, 10);
                    if (paymentFromDate && day < paymentFromDate) return false;
                    if (paymentToDate && day > paymentToDate) return false;
                    return true;
                  });
                  if (rows.length === 0 && !isLoadingPayments) {
                    return <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">No payments found.</td></tr>;
                  }
                  return rows.map((p) => {
                    const statusInfo = STATUS_LABEL[p.status] || STATUS_LABEL.pending;
                    return (
                      <tr key={p.id} onClick={() => handleSelectFromList(p.email)} className="cursor-pointer hover:bg-blue-50">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{new Date(p.created_at).toLocaleString('en-IN')}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{p.name} · {p.email}</td>
                        <td className="px-3 py-2 text-slate-700">{p.plan} · {p.billing_cycle}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">
                          {p.amount_paise > 0 ? `₹${(p.amount_paise / 100).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusInfo.className}`}>{statusInfo.label}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{SOURCE_LABEL[p.source] || p.source}</td>
                        <td className="px-3 py-2 text-slate-500">{p.razorpay_payment_id || p.failure_reason || p.note || '—'}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'find' && (
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
          <h2 className="text-lg font-bold text-slate-900">Find a user</h2>
          <form onSubmit={handleSearch} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full flex-1 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
              required
            />
            <button type="submit" disabled={isSearching} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700 disabled:opacity-50">
              <Search className="h-4 w-4" />
              {isSearching ? 'Searching…' : 'Search'}
            </button>
          </form>
          {lookupError && <p className="mt-2 text-xs text-red-600">{lookupError}</p>}
        </div>
        )}

        {activeTab === 'chat' && (
        <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card">
          <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr] sm:divide-x sm:divide-slate-200">
            <div className="max-h-[32rem] overflow-y-auto border-b border-slate-200 sm:border-b-0">
              <div className="px-4 py-3">
                <h2 className="text-sm font-bold text-slate-900">Conversations</h2>
                {chatError && <p className="mt-1 text-xs text-red-600">{chatError}</p>}
              </div>
              {isLoadingConversations && <p className="px-4 pb-3 text-xs text-slate-400">Loading…</p>}
              {!isLoadingConversations && conversations.length === 0 && (
                <p className="px-4 pb-4 text-xs text-slate-400">No messages from users yet.</p>
              )}
              {conversations.map((c) => (
                <button
                  key={c.user_id}
                  type="button"
                  onClick={() => handleOpenChat(c.user_id)}
                  className={`flex w-full items-start gap-2.5 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 ${
                    activeChatUserId === c.user_id ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                    {(c.name || c.email).trim().slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="truncate text-xs font-semibold text-slate-900">{c.name || c.email}</p>
                      {c.unread_count > 0 && (
                        <span className="shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{c.unread_count}</span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-slate-500">
                      {c.last_sender === 'admin' ? 'You: ' : ''}{c.last_message}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex h-[28rem] flex-col sm:h-[32rem]">
              {!activeChatUserId ? (
                <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-400">
                  Select a conversation to view messages.
                </div>
              ) : (
                <>
                  <div className="flex-1 space-y-2 overflow-y-auto p-4">
                    {chatMessages.map((m) => (
                      <div key={m.id} className={`flex ${m.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs ${
                          m.sender === 'admin' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
                        }`}>
                          <p>{m.body}</p>
                          <p className={`mt-1 text-[9px] ${m.sender === 'admin' ? 'text-blue-100' : 'text-slate-400'}`}>
                            {new Date(m.created_at).toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>
                    ))}
                    {chatMessages.length === 0 && (
                      <p className="py-8 text-center text-xs text-slate-400">No messages yet in this conversation.</p>
                    )}
                  </div>
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleSendChat(); }}
                    className="flex items-center gap-2 border-t border-slate-200 p-3"
                  >
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Type a message"
                      className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 focus:bg-white"
                    />
                    <button
                      type="submit"
                      disabled={isSendingChat || !chatInput.trim()}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-50"
                      aria-label="Send"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
        )}

        {activeTab === 'analytics' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <h2 className="text-sm font-bold text-slate-900">Revenue - last 14 days</h2>
            <p className="text-[11px] text-slate-400">Successful payments only (₹)</p>
            <div className="mt-4 flex h-36 items-end gap-1.5">
              {revenueByDay.map((d) => (
                <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end" title={`${new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ₹${d.amount.toLocaleString('en-IN')}`}>
                  <div
                    className="w-full rounded-t-sm"
                    style={{ height: `${Math.max(3, (d.amount / maxDailyRevenue) * 100)}%`, backgroundColor: '#2a78d6' }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[9px] text-slate-400">
              <span>{new Date(days14[0]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              <span>{new Date(days14[days14.length - 1]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <h2 className="text-sm font-bold text-slate-900">New signups - last 14 days</h2>
            <p className="text-[11px] text-slate-400">Registered accounts per day</p>
            <div className="mt-4 flex h-36 items-end gap-1.5">
              {signupsByDay.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${d.count} signup(s)`}>
                  <div
                    className="w-full rounded-t-sm"
                    style={{ height: `${Math.max(3, (d.count / maxDailySignups) * 100)}%`, backgroundColor: '#2a78d6' }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[9px] text-slate-400">
              <span>{new Date(days14[0]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              <span>{new Date(days14[days14.length - 1]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <h2 className="text-sm font-bold text-slate-900">Users by plan</h2>
            <div className="mt-4 space-y-3">
              {planCounts.map((p) => (
                <div key={p.plan}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium capitalize text-slate-700">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLAN_COLOR[p.plan] }} />
                      {p.plan}
                    </span>
                    <span className="font-semibold text-slate-900">{p.count}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${(p.count / maxPlanCount) * 100}%`, backgroundColor: PLAN_COLOR[p.plan] }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <h2 className="text-sm font-bold text-slate-900">Payments by status</h2>
            <div className="mt-4 space-y-3">
              {statusCounts.map((s) => (
                <div key={s.status}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium capitalize text-slate-700">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[s.status] }} />
                      {s.status}
                    </span>
                    <span className="font-semibold text-slate-900">{s.count}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${(s.count / maxStatusCount) * 100}%`, backgroundColor: STATUS_COLOR[s.status] }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-slate-400">
              Profit/loss isn't shown here - expenses (server, ads, etc.) aren't tracked anywhere in the system yet, only revenue.
            </p>
          </div>
        </div>
        )}

        {activeTab === 'activity' && (
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-900">Activity log</h2>
            </div>
            <span className="text-xs font-medium text-slate-400">{isLoadingAudit ? 'Loading…' : `${auditEntries.length} entries`}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Every grant, expire, and coupon action taken from this admin panel.</p>
          {auditError && <p className="mt-2 text-xs text-red-600">{auditError}</p>}
          <div className="mt-3 max-h-96 overflow-y-auto overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Target / Code</th>
                  <th className="px-3 py-2 font-semibold">Days</th>
                  <th className="px-3 py-2 font-semibold">New plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditEntries.length === 0 && !isLoadingAudit && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">No activity recorded yet.</td></tr>
                )}
                {auditEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{new Date(e.created_at).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">{(e.action || 'grant').replace(/_/g, ' ')}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{e.target_email}</td>
                    <td className="px-3 py-2 text-slate-700">{e.extra_days || '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{e.new_plan || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'profile' && (
        <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card">
          <div className="h-24 bg-gradient-to-r from-blue-500 to-indigo-600 sm:h-28" />
          <div className="px-6 pb-6">
            <div className="-mt-10 flex flex-wrap items-end justify-between gap-3 sm:-mt-12">
              <div className="flex items-end gap-3">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-4 border-white bg-blue-600 shadow-lg shadow-blue-600/30 sm:h-24 sm:w-24">
                  <User className="h-9 w-9 text-white sm:h-10 sm:w-10" />
                </div>
                <div className="pb-1">
                  <h2 className="text-lg font-bold text-slate-900">Admin</h2>
                  <p className="text-xs text-slate-500">DWIS TAP Admin Panel</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] uppercase text-slate-400">Total users</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{allUsers.length.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] uppercase text-slate-400">New signups (24h)</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{newSignups.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] uppercase text-slate-400">Plans expiring soon</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{expiringSoon.length}</p>
            </div>
          </div>
          <p className="mt-5 text-xs text-slate-500">
            Admin access is passcode-based (set via <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">ADMIN_PASSCODE</code> on the server) - there's no separate admin account record to edit here. To change the passcode, update that environment variable on the server and redeploy.
          </p>
          </div>
        </div>
        )}

        {activeTab === 'coupons' && (
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex items-center gap-2">
            <Ticket className="h-4 w-4 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">Discount coupons</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Percent-off codes for the checkout screen - separate from the trial-extend bonus codes. Each account can use a given coupon only once.
          </p>

          <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase text-amber-700">Trial-extend codes (fixed, not in this table)</p>
              <button
                type="button"
                onClick={() => setShowTrialCodes((v) => !v)}
                className="shrink-0 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-50"
              >
                {showTrialCodes ? 'Hide' : 'Reveal'}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {showTrialCodes ? (
                <>
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono">DWIS15</code>,{' '}
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono">DWISFREE</code>,{' '}
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono">TRIAL15</code>
                </>
              ) : (
                <code className="rounded bg-white px-1.5 py-0.5 font-mono tracking-widest text-slate-400">••••••</code>
              )}
              {' '}— each adds 15 extra trial days when entered in the "Enter bonus offer code" box. Hardcoded in Supabase (not creatable from here); unlimited reuse by any account.
            </p>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <input
              type="text"
              value={newCouponCode}
              onChange={(e) => setNewCouponCode(e.target.value)}
              placeholder="CODE"
              className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
            <input
              type="number"
              min={1}
              max={100}
              value={newCouponPercent}
              onChange={(e) => setNewCouponPercent(e.target.value)}
              placeholder="% off"
              className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
            <input
              type="date"
              value={newCouponExpiry}
              onChange={(e) => setNewCouponExpiry(e.target.value)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleCreateCoupon}
              disabled={isCreatingCoupon}
              className="rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700 disabled:opacity-50"
            >
              {isCreatingCoupon ? 'Saving…' : 'Create / update'}
            </button>
          </div>
          {couponError && <p className="mt-2 text-xs text-red-600">{couponError}</p>}

          <div className="mt-3 max-h-72 overflow-y-auto overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Code</th>
                  <th className="px-3 py-2 font-semibold">% off</th>
                  <th className="px-3 py-2 font-semibold">Used</th>
                  <th className="px-3 py-2 font-semibold">Expires</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {coupons.length === 0 && !isLoadingCoupons && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No coupons yet.</td></tr>
                )}
                {coupons.map((c) => (
                  <tr key={c.code}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{c.code}</td>
                    <td className="px-3 py-2 text-slate-700">{c.discount_percent}%</td>
                    <td className="px-3 py-2 text-slate-700">{c.times_redeemed}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{c.expires_at ? new Date(c.expires_at).toLocaleDateString('en-IN') : '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${c.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {c.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleToggleCoupon(c.code, !c.active)}
                        className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {c.active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'find' && foundUser && (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">User profile</p>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-700">
                {(foundUser.name || foundUser.email).trim().slice(0, 1).toUpperCase()}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{foundUser.name}</h3>
                <p className="text-xs text-slate-500">{foundUser.email}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-600 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase text-slate-400">Plan</p>
                <p className="font-semibold text-slate-900">{foundUser.plan}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase text-slate-400">Expires</p>
                <p className="font-semibold text-slate-900">{new Date(foundUser.expires_at).toLocaleDateString('en-IN')}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase text-slate-400">OCR used (period)</p>
                <p className="font-semibold text-slate-900">{foundUser.ocr_used}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase text-slate-400">OCR used today</p>
                <p className="font-semibold text-slate-900">
                  {usedToday(foundUser)} / {DAILY_OCR_PAGE_LIMITS[foundUser.plan as PlanId] ?? '—'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase text-slate-400">Billing</p>
                <p className="font-semibold text-slate-900">{foundUser.billing_cycle}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
              <p className="text-sm font-bold text-slate-900">Grant / extend access</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Days to add</label>
                  <input
                    type="number"
                    min={1}
                    value={grantDays}
                    onChange={(e) => setGrantDays(e.target.value)}
                    className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Plan</label>
                  <select
                    value={grantPlan}
                    onChange={(e) => setGrantPlan(e.target.value)}
                    className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                  >
                    <option value="trial">trial</option>
                    <option value="basic">basic</option>
                    <option value="pro">pro</option>
                  </select>
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Cash received (₹) — leave blank for a free/courtesy grant</label>
                  <input
                    type="number"
                    min={0}
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    placeholder="e.g. 300"
                    className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Note (optional)</label>
                  <input
                    type="text"
                    value={grantNote}
                    onChange={(e) => setGrantNote(e.target.value)}
                    placeholder="e.g. Paid in person, Basic monthly"
                    className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleGrant}
                  disabled={isGranting}
                  className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {isGranting ? 'Applying…' : 'Grant access'}
                </button>
                <button
                  type="button"
                  onClick={handleExpireNow}
                  disabled={isExpiring}
                  className="rounded-full border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  {isExpiring ? 'Expiring…' : 'Expire access now'}
                </button>
              </div>
              {grantMessage && <p className="mt-2 text-xs font-medium text-slate-700">{grantMessage}</p>}
            </div>

            <div className="mt-5">
              <p className="text-sm font-bold text-slate-900">Payment history</p>
              {payments.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No Razorpay payments recorded for this account yet.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Source</th>
                        <th className="px-3 py-2 font-semibold">Plan</th>
                        <th className="px-3 py-2 font-semibold">Cycle</th>
                        <th className="px-3 py-2 font-semibold">Amount</th>
                        <th className="px-3 py-2 font-semibold">Reference / Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">{new Date(p.created_at).toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              p.source === 'razorpay' ? 'bg-blue-100 text-blue-700' : p.source === 'cash' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {SOURCE_LABEL[p.source] || p.source}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{p.plan}</td>
                          <td className="px-3 py-2 text-slate-700">{p.billing_cycle}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">
                            {p.amount_paise > 0 ? `₹${(p.amount_paise / 100).toLocaleString('en-IN')}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{p.razorpay_payment_id || p.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
