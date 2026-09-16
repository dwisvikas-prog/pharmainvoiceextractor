import { useState } from 'react';
import { Check, Ticket, X as XIcon } from 'lucide-react';
import { PLAN_PRICING, TRIAL_DAYS, getVerifyOcrLimit, type AccessBlockReason, type AuthSession, type BillingCycle, type PlanId } from '../utils/auth';
import { SHOW_PAYMENT_CHECKOUT, TAP_PLAN_FEATURES, TAP_TIER_INCLUDED } from '../utils/constants';

function PlanFeatureList({ includedCount }: { includedCount: number }) {
  return (
    <ul className="mt-3 space-y-1 text-xs">
      {TAP_PLAN_FEATURES.map((feature, i) => {
        const included = i < includedCount;
        return (
          <li key={feature} className={`flex items-center gap-1.5 ${included ? 'text-slate-700' : 'text-slate-400'}`}>
            {included ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XIcon className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
            <span className={included ? '' : 'line-through'}>{feature}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function PlanCheckoutGrid({ onActivatePlan }: { onActivatePlan: (plan: Exclude<PlanId, 'trial'>, cycle: BillingCycle) => void }) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-[#1e86bb]">Basic · monthly</p>
        <p className="mt-1 text-xl font-black">₹{PLAN_PRICING.basic.monthly} incl. GST</p>
        <PlanFeatureList includedCount={TAP_TIER_INCLUDED.basic} />
        <button type="button" onClick={() => onActivatePlan('basic', 'monthly')} className="mt-4 rounded-full bg-[#1e86bb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1970a0]">
          Pay Basic monthly
        </button>
      </div>
      <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-[#1e86bb]">Premium · monthly</p>
        <p className="mt-1 text-xl font-black">₹{PLAN_PRICING.pro.monthly}</p>
        <PlanFeatureList includedCount={TAP_TIER_INCLUDED.premium} />
        <button type="button" onClick={() => onActivatePlan('pro', 'monthly')} className="mt-4 rounded-full bg-[#1e86bb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1970a0]">
          Pay Premium monthly
        </button>
      </div>
      <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-[#1e86bb]">Basic · yearly</p>
        <p className="mt-1 text-xl font-black">₹{PLAN_PRICING.basic.yearly}</p>
        <PlanFeatureList includedCount={TAP_TIER_INCLUDED.basic} />
        <button type="button" onClick={() => onActivatePlan('basic', 'yearly')} className="mt-4 rounded-full bg-[#1e86bb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1970a0]">
          Pay Basic yearly
        </button>
      </div>
      <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase text-[#1e86bb]">Premium · yearly</p>
        <p className="mt-1 text-xl font-black">₹{PLAN_PRICING.pro.yearly}</p>
        <PlanFeatureList includedCount={TAP_TIER_INCLUDED.premium} />
        <button type="button" onClick={() => onActivatePlan('pro', 'yearly')} className="mt-4 rounded-full bg-[#1e86bb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1970a0]">
          Pay Premium yearly
        </button>
      </div>
    </div>
  );
}

const CONTACT = { tel: '9988336023', href: 'tel:9988336023' };

interface AccessPaywallProps {
  session: AuthSession;
  reason: AccessBlockReason;
  onLogout: () => void;
  onActivatePlan: (plan: Exclude<PlanId, 'trial'>, cycle: BillingCycle) => void;
  onRedeemPasscode: (code: string) => Promise<{ ok: boolean; message: string }>;
}

export default function AccessPaywall({ session, reason, onLogout, onActivatePlan, onRedeemPasscode }: AccessPaywallProps) {
  const limit = getVerifyOcrLimit(session.plan);
  const title = reason === 'ocr_limit' ? 'Verify OCR limit reached' : 'Plan or trial ended';
  const detail =
    reason === 'ocr_limit'
      ? `This account used ${session.ocrUsed} of ${limit} Verify OCR pages this period.`
      : `Access ended on ${new Date(session.expiresAt).toLocaleDateString('en-IN')}.`;

  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [isOk, setIsOk] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleApply = async () => {
    if (!code.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setMessage('');
    try {
      const result = await onRedeemPasscode(code);
      setIsOk(result.ok);
      setMessage(result.message);
      if (result.ok) setCode('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-[#f8fafc] px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">DWIS TAP access</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{detail} Studio stays locked until the next plan is active.</p>
        <p className="mt-4 text-sm text-slate-700">
          Logged in as <span className="font-semibold">{session.user.name}</span> ({session.user.email}). Current plan: {session.plan}.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          How to continue: Contact us. After payment is confirmed you get access for the next {session.billingCycle === 'yearly' ? 'year' : 'month'} (bonus offer: a code for {TRIAL_DAYS} extra days).
        </p>

        <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Ticket className="h-4 w-4 text-blue-600" />
            Have a bonus offer code?
          </p>
          <p className="mt-1 text-xs text-slate-600">This is a one-time bonus, not a plan — pick Basic or Premium below to keep full access without interruption.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
              placeholder="Enter bonus offer code"
              className="w-full flex-1 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleApply}
              disabled={isSubmitting || !code.trim()}
              className="shrink-0 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-cta transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Applying…' : 'Redeem bonus'}
            </button>
          </div>
          {message && (
            <p className={`mt-2 text-xs font-medium ${isOk ? 'text-emerald-700' : 'text-red-600'}`}>{message}</p>
          )}
        </div>

        {SHOW_PAYMENT_CHECKOUT && <PlanCheckoutGrid onActivatePlan={onActivatePlan} />}

        <div className="mt-6 flex flex-wrap gap-3">
          <a href={CONTACT.href} className="inline-flex rounded-full bg-[#1e86bb] px-5 py-2.5 text-sm font-semibold text-white no-underline hover:bg-[#1970a0]">
            Contact us · {CONTACT.tel}
          </a>
          <button type="button" onClick={onLogout} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700">
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
