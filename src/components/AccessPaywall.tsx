import { PLAN_PRICING, TRIAL_DAYS, getVerifyOcrLimit, type AccessBlockReason, type AuthSession, type BillingCycle, type PlanId } from '../utils/auth';
import { SHOW_PAYMENT_CHECKOUT } from '../utils/constants';

const CONTACT = { tel: '9988336023', href: 'tel:9988336023' };

interface AccessPaywallProps {
  session: AuthSession;
  reason: AccessBlockReason;
  onLogout: () => void;
  onActivatePlan: (plan: Exclude<PlanId, 'trial'>, cycle: BillingCycle) => void;
}

export default function AccessPaywall({ session, reason, onLogout, onActivatePlan }: AccessPaywallProps) {
  const limit = getVerifyOcrLimit(session.plan);
  const title = reason === 'ocr_limit' ? 'Verify OCR limit reached' : 'Plan or trial ended';
  const detail =
    reason === 'ocr_limit'
      ? `This account used ${session.ocrUsed} of ${limit} Verify OCR pages this period.`
      : `Access ended on ${new Date(session.expiresAt).toLocaleDateString('en-IN')}.`;

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
          How to continue: Contact us. After payment is confirmed you get access for the next {session.billingCycle === 'yearly' ? 'year' : 'month'} (trial extra: passcode for {TRIAL_DAYS} days).
        </p>

        {SHOW_PAYMENT_CHECKOUT && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => onActivatePlan('basic', 'monthly')} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-bold uppercase text-[#1e86bb]">Pay Basic monthly</p>
              <p className="mt-1 text-xl font-black">₹{PLAN_PRICING.basic.monthly} incl. GST</p>
            </button>
            <button type="button" onClick={() => onActivatePlan('pro', 'monthly')} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-bold uppercase text-[#1e86bb]">Pay Premium monthly</p>
              <p className="mt-1 text-xl font-black">₹{PLAN_PRICING.pro.monthly}</p>
            </button>
            <button type="button" onClick={() => onActivatePlan('basic', 'yearly')} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-bold uppercase text-[#1e86bb]">Pay Basic yearly</p>
              <p className="mt-1 text-xl font-black">₹{PLAN_PRICING.basic.yearly}</p>
            </button>
            <button type="button" onClick={() => onActivatePlan('pro', 'yearly')} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-bold uppercase text-[#1e86bb]">Pay Premium yearly</p>
              <p className="mt-1 text-xl font-black">₹{PLAN_PRICING.pro.yearly}</p>
            </button>
          </div>
        )}

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
