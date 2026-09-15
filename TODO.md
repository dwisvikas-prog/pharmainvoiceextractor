# DWIS TAP — Pending Items

## Required before going live

- [ ] **Razorpay keys** — `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are still blank in `.env`.
      Get test (or live) keys from the Razorpay dashboard → Settings → API Keys.
      Without these, the "Pay" buttons show "Payments are not configured yet."

- [ ] **Deploy to Vercel** — everything built so far (admin panel, payments, hardened auth)
      only runs locally (`localhost:3000`) right now. Before/when deploying, add these
      env vars to the Vercel project settings (Production + Preview + Development):
      - `SUPABASE_SERVICE_ROLE_KEY`
      - `ADMIN_PASSCODE`
      - `ADMIN_TOKEN_SECRET`
      - `RAZORPAY_KEY_ID`
      - `RAZORPAY_KEY_SECRET` (once obtained)
      (`GEMINI_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` should already be set from before.)

## Optional / your call

- [ ] Reset the test account ("aman" / vikasuniyal0810@gmail.com) to a clean state —
      it's currently on a far-future trial expiry from testing.
- [ ] Real email notifications for "plan expiring soon" (currently only an in-app banner
      at ≤4 days left). Needs an email service (e.g. Resend, SendGrid) if wanted.

## Already done and tested

- Mobile-responsive layout (landing page + studio app)
- Landing page visual polish (icons, hover states, FAQ accordion, hero glow)
- Friendly "confirm your email" / "email not confirmed" flows with resend + cooldown
- Admin panel at `/#admin` (passcode-protected, separate from user login)
  - Search any user by email, view plan/expiry/OCR usage
  - Grant/extend access (days + plan), with optional cash amount + note
  - Audit log of every admin grant, login attempt logging, short session (2h),
    separate token-signing secret from the login passcode
- Payment history (per user, shown in admin panel):
  - Razorpay payments (once keys are added)
  - Cash payments entered by admin
  - Coupon/passcode redemptions (`DWIS15`, `DWISFREE`, `TRIAL15` — each adds 15 days)
- Single source of truth for all this DB logic: `supabase/admin_and_payments.sql`
  (re-run this file in the Supabase SQL Editor whenever it changes — no other file needed)
