// @ts-nocheck
import { useState, useEffect } from 'react';
import { ShieldCheck, Search, User, Users, Ticket, Menu, X as CloseIcon, CreditCard, LogOut, IndianRupee, TrendingUp, AlertCircle } from 'lucide-react';
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

type AdminTab = 'users' | 'payments' | 'coupons' | 'find';

const NAV_ITEMS: { key: AdminTab; label: string; icon: typeof Users }[] = [
  { key: 'users', label: 'Registered users', icon: Users },
  { key: 'payments', label: 'All payments', icon: CreditCard },
  { key: 'coupons', label: 'Discount coupons', icon: Ticket },
  { key: 'find', label: 'Find a user', icon: Search },
];

export default function AdminPanel() {
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; }
  });
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [menuOpen, setMenuOpen] = useState(false);
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

  const [allPayments, setAllPayments] = useState<GlobalPaymentRecord[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [paymentsError, setPaymentsError] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'success' | 'failed' | 'pending'>('all');

  const [coupons, setCoupons] = useState<DiscountCoupon[]>([]);
  const [isLoadingCoupons, setIsLoadingCoupons] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponPercent, setNewCouponPercent] = useState('10');
  const [newCouponExpiry, setNewCouponExpiry] = useState('');
  const [isCreatingCoupon, setIsCreatingCoupon] = useState(false);
  const [showTrialCodes, setShowTrialCodes] = useState(false);

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
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b1120] px-4">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <form onSubmit={handleLogin} className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-900/40">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <p className="mt-4 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">DWIS TAP Admin</p>
          <h1 className="mt-1 text-center text-xl font-black text-white">Welcome back</h1>
          <p className="mt-1 text-center text-sm text-slate-400">Enter the admin passcode to continue.</p>
          <input
            type="password"
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            placeholder="Admin passcode"
            className="mt-5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:bg-white/10"
            required
            autoFocus
          />
          {loginError && (
            <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {loginError}
            </p>
          )}
          <button
            type="submit"
            disabled={isLoggingIn}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50"
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

  const KPI_CARDS = [
    { label: 'Total users', value: allUsers.length.toLocaleString('en-IN'), icon: Users, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
    { label: 'Paid plans', value: paidPlansCount.toLocaleString('en-IN'), icon: TrendingUp, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
    { label: 'Revenue (success)', value: `₹${revenueTotal.toLocaleString('en-IN')}`, icon: IndianRupee, iconBg: 'bg-indigo-50', iconColor: 'text-indigo-600' },
    { label: 'Failed payments', value: failedCount.toLocaleString('en-IN'), icon: AlertCircle, iconBg: 'bg-rose-50', iconColor: 'text-rose-600' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col bg-[#0b1120] px-4 py-6 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-900/40">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-black leading-tight text-white">DWIS TAP</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-300">Admin</p>
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
                  isActive ? 'bg-blue-600/15 text-blue-400' : 'text-slate-400 hover:bg-white/5 hover:text-white'
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
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Logout
        </button>
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-20 flex items-center justify-between bg-[#0b1120] px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => setMenuOpen((v) => !v)} className="rounded-full border border-white/10 bg-white/5 p-2 text-white" aria-label="Menu">
            {menuOpen ? <CloseIcon className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="flex items-center gap-2 text-white">
            <ShieldCheck className="h-4 w-4 text-blue-400" />
            <p className="text-xs font-bold uppercase tracking-[0.14em]">DWIS TAP Admin</p>
          </div>
        </div>
        <button type="button" onClick={handleLogout} className="rounded-full border border-white/10 bg-white/5 p-2 text-white" aria-label="Logout">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 bg-[#0b1120] p-4 shadow-2xl">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => { setActiveTab(item.key); setMenuOpen(false); }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium ${
                    activeTab === item.key ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
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
            <span className="text-xs font-medium text-slate-400">{isLoadingUsers ? 'Loading…' : `${allUsers.length} shown`}</span>
          </div>
          <input
            type="text"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="mt-3 w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
          />
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
                {allUsers.length === 0 && !isLoadingUsers && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No users found.</td></tr>
                )}
                {allUsers.map((u) => (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'payments' && (
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-slate-900">All payments</h2>
            <div className="flex items-center gap-2">
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
                  const rows = paymentStatusFilter === 'all' ? allPayments : allPayments.filter((p) => p.status === paymentStatusFilter);
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
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">{foundUser.name} · {foundUser.email}</h3>
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
