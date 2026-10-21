import { createClient } from '@supabase/supabase-js';
import { apiUrl } from './apiBase';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export type PlanId = 'trial' | 'basic' | 'pro';
export type BillingCycle = 'monthly' | 'yearly';

export interface AuthSession {
  token: string;
  sessionToken: string;
  expiresAt: string;
  user: AuthUser;
  plan: PlanId;
  billingCycle: BillingCycle;
  ocrUsed: number;
  ocrPeriodKey: string;
  ocrUsedToday: number;
  ocrDayKey: string;
}

export interface AuthPayload {
  name?: string;
  email: string;
  password: string;
}

export const TRIAL_DAYS = 15;

export const VERIFY_OCR_PAGE_LIMITS: Record<PlanId, number> = {
  trial: 40,
  basic: 100,
  pro: 180
};

// Per-day cap on top of the monthly limit above - applies the same way to
// a plan's monthly or yearly billing cycle (e.g. basic monthly=300/yearly=3000
// both get 20/day). Resets at midnight with no rollover of unused quota.
export const DAILY_OCR_PAGE_LIMITS: Record<PlanId, number> = {
  trial: 10,
  basic: 20,
  pro: 50
};

export const PLAN_PRICING = {
  basic: {
    monthly: 300,
    yearly: 3000,
    description: 'For starter invoice processing'
  },
  pro: {
    monthly: 500,
    yearly: 5000,
    description: 'Higher processing limits and faster workflows'
  }
} as const;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// This device's copy of the "which login owns this account right now"
// token. A fresh one is written here on every login/register; it never
// changes just because another device logs in - that's exactly how we
// detect this device got kicked out (see isSessionStillActive).
const LOCAL_SESSION_TOKEN_KEY = 'dwis_active_session_token';

// Thrown when the server confirms another device is now the active login.
// App.tsx catches this specifically to force a logout with a clear message,
// instead of showing it as a generic error.
export class SessionInvalidatedError extends Error {
  constructor() {
    super(
      'You have been signed out because this account was logged in on another device or browser. ' +
      'Only one active session is allowed per account. Signing in on multiple devices at once may ' +
      'result in this account being suspended. Please use a single device and browser to stay signed in.'
    );
    this.name = 'SessionInvalidatedError';
  }
}

type EntitlementRow = {
  plan: PlanId;
  billing_cycle: BillingCycle;
  expires_at: string;
  ocr_used: number;
  ocr_period_key: string;
  ocr_used_today: number;
  ocr_day_key: string;
  active_session_token: string | null;
};

export const getVerifyOcrLimit = (plan: PlanId) => VERIFY_OCR_PAGE_LIMITS[plan] ?? VERIFY_OCR_PAGE_LIMITS.trial;
export const getDailyOcrLimit = (plan: PlanId) => DAILY_OCR_PAGE_LIMITS[plan] ?? DAILY_OCR_PAGE_LIMITS.trial;

export const getDaysUntilExpiry = (expiresAt: string) => {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
};

export const isExpiryWarningWindow = (expiresAt: string) => {
  const daysLeft = getDaysUntilExpiry(expiresAt);
  return daysLeft <= 4 && daysLeft > 0;
};

export const isPlanExpired = (session: AuthSession) => new Date(session.expiresAt).getTime() <= Date.now();

export const isOcrLimitReached = (session: AuthSession) => session.ocrUsed >= getVerifyOcrLimit(session.plan);

// ocrUsedToday is only meaningful for the current server day - if the row's
// day key is stale (nothing recorded yet today), today's usage is really 0,
// which is also how "no rollover" falls out: yesterday's count just doesn't
// carry over once the day key moves on.
const todayKey = () => new Date().toISOString().slice(0, 10);

export const getOcrUsedToday = (session: AuthSession) => (session.ocrDayKey === todayKey() ? session.ocrUsedToday : 0);

export const isDailyOcrLimitReached = (session: AuthSession) => getOcrUsedToday(session) >= getDailyOcrLimit(session.plan);

export type AccessBlockReason = 'ok' | 'expired' | 'ocr_limit' | 'daily_ocr_limit';

export const getAccessBlockReason = (session: AuthSession): AccessBlockReason => {
  if (isPlanExpired(session)) return 'expired';
  if (isOcrLimitReached(session)) return 'ocr_limit';
  if (isDailyOcrLimitReached(session)) return 'daily_ocr_limit';
  return 'ok';
};

const buildSession = (
  userId: string,
  email: string,
  name: string,
  token: string,
  sessionToken: string,
  row: EntitlementRow
): AuthSession => ({
  token,
  sessionToken,
  expiresAt: row.expires_at,
  user: { id: userId, name, email },
  plan: row.plan,
  billingCycle: row.billing_cycle,
  ocrUsed: row.ocr_used,
  ocrPeriodKey: row.ocr_period_key,
  ocrUsedToday: row.ocr_used_today,
  ocrDayKey: row.ocr_day_key
});

const fetchEntitlements = async (userId: string): Promise<EntitlementRow> => {
  const { data, error } = await supabase.from('entitlements').select('*').eq('user_id', userId).single();
  if (error || !data) throw new Error(error?.message || 'Could not load account details.');
  return data as EntitlementRow;
};

// The signup trigger that creates the entitlements row runs in the same
// transaction as account creation, but we retry briefly just in case of
// replication lag on the read path.
const fetchEntitlementsWithRetry = async (userId: string, attempts = 4): Promise<EntitlementRow> => {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchEntitlements(userId);
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not load account details.');
};

const SESSION_LOCKED_MESSAGE =
  'This account is already logged in on another device or browser. Please log out there first, ' +
  'or wait about a minute if that device is unreachable, then try again.';

// Claims the account's single login slot. Rejects if another device
// heartbeated within the last 60 seconds (see supabase/exclusive_login.sql)
// - a second device simply cannot log in while the first is active.
const claimSession = async (): Promise<string> => {
  const { data, error } = await supabase.rpc('claim_session');
  if (error?.message?.includes('session_active_elsewhere')) {
    throw new Error(SESSION_LOCKED_MESSAGE);
  }
  if (error || !data) throw new Error(error?.message || 'Could not start a session.');
  const token = data as string;
  localStorage.setItem(LOCAL_SESSION_TOKEN_KEY, token);
  return token;
};

const clearLocalSessionToken = () => {
  localStorage.removeItem(LOCAL_SESSION_TOKEN_KEY);
};

export const getStoredSession = async (): Promise<AuthSession | null> => {
  const { data } = await supabase.auth.getSession();
  const authSession = data.session;
  if (!authSession?.user?.email) return null;

  try {
    const row = await fetchEntitlements(authSession.user.id);
    const localToken = localStorage.getItem(LOCAL_SESSION_TOKEN_KEY);

    // Someone logged in on another device since this tab last checked -
    // this device is no longer the active session. Sign out here instead
    // of returning a session, so a page reload behaves like a real logout.
    if (!localToken || !row.active_session_token || localToken !== row.active_session_token) {
      await supabase.auth.signOut();
      clearLocalSessionToken();
      return null;
    }

    const name = (authSession.user.user_metadata?.name as string) || authSession.user.email.split('@')[0];
    return buildSession(authSession.user.id, authSession.user.email, name, authSession.access_token, localToken, row);
  } catch {
    return null;
  }
};

// Call periodically (and before sensitive actions) while a session is
// active. Returns false the moment another device has taken over.
export const isSessionStillActive = async (session: AuthSession): Promise<boolean> => {
  const { data, error } = await supabase.rpc('check_session', { session_token: session.sessionToken });
  if (error) return false;
  return Boolean(data);
};

export const registerUser = async (payload: AuthPayload): Promise<AuthSession> => {
  const email = payload.email.trim().toLowerCase();
  const name = (payload.name || 'DWIS User').trim();
  if (!email || !payload.password.trim()) {
    throw new Error('Email and password are required.');
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: payload.password,
    options: { data: { name } }
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Registration failed.');

  // Supabase deliberately returns a 200 with no error for an email that's
  // already registered (so attackers can't enumerate accounts via signup) -
  // it just comes back with an empty identities array and sends no email.
  // Surface that as a clear "already registered" message instead of letting
  // it fall through to the generic "check your email" success path below.
  if (data.user.identities && data.user.identities.length === 0) {
    throw new Error('This email is already registered. Please log in instead, or use "Forgot password" if you don\'t remember your password.');
  }

  if (!data.session) {
    throw new Error('Account created. Check your email to confirm before logging in.');
  }

  const row = await fetchEntitlementsWithRetry(data.user.id);
  let sessionToken: string;
  try {
    sessionToken = await claimSession();
  } catch (claimErr) {
    await supabase.auth.signOut();
    throw claimErr;
  }
  return buildSession(data.user.id, email, name, data.session.access_token, sessionToken, row);
};

export const loginUser = async (payload: AuthPayload): Promise<AuthSession> => {
  const email = payload.email.trim().toLowerCase();
  if (!email || !payload.password.trim()) {
    throw new Error('Email and password are required.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: payload.password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Invalid email or password.' : error.message);
  if (!data.user || !data.session) throw new Error('Login failed.');

  const row = await fetchEntitlements(data.user.id);
  const name = (data.user.user_metadata?.name as string) || email.split('@')[0];
  // Claiming here is what blocks login while another device is active -
  // if that device is still heartbeating, this throws and we must sign the
  // just-created Supabase auth session back out so the account stays free.
  let sessionToken: string;
  try {
    sessionToken = await claimSession();
  } catch (claimErr) {
    await supabase.auth.signOut();
    throw claimErr;
  }
  return buildSession(data.user.id, email, name, data.session.access_token, sessionToken, row);
};

// Fresh Supabase access token for calling authenticated serverless
// endpoints (e.g. Razorpay order create/verify) - session.token can go
// stale after an hour, so read it live instead.
export const getAccessToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

export const resendConfirmationEmail = async (email: string): Promise<void> => {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
  if (error) throw new Error(error.message);
};

// Sends the "reset your password" email. Supabase redirects the user back
// to redirectTo with a recovery token in the URL hash; App.tsx listens for
// the PASSWORD_RECOVERY auth event to show the "set new password" form.
//
// Supabase's own resetPasswordForEmail() always returns success (even for an
// email that was never registered) to prevent account enumeration. We check
// first via our own /api/check-email endpoint so an unregistered user gets a
// clear "no account" message instead of a misleading "check your inbox".
export const sendPasswordResetEmail = async (email: string): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();

  const isRegistered = await checkEmailRegistered(normalizedEmail);
  if (isRegistered === false) {
    throw new Error('No account found with that email. Please register first.');
  }

  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
  if (error) throw new Error(error.message);
};

// Returns true/false if the check succeeded, or null if the check endpoint
// itself failed - callers should fall back to the generic Supabase flow
// rather than block a legitimate reset on our own endpoint being down.
const checkEmailRegistered = async (email: string): Promise<boolean | null> => {
  try {
    const response = await fetch(apiUrl('/api/check-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return Boolean(data.registered);
  } catch {
    return null;
  }
};

// Verifies the recovery token_hash from the reset email link and sets the
// new password in one step. We deliberately do NOT call verifyOtp as soon
// as the link is opened (on page load) - that is what lets email security
// scanners (Gmail/Outlook link prefetching) silently consume the one-time
// token before the user ever clicks, which is why links were showing
// "invalid or expired". Verifying only here, inside the user's own submit
// action, means it only ever runs on a real click.
export const resetPasswordWithRecoveryToken = async (tokenHash: string, newPassword: string): Promise<void> => {
  if (!newPassword.trim()) throw new Error('Please enter a new password.');

  const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (verifyError) throw new Error(verifyError.message || 'This reset link is invalid or has expired. Please request a new one.');

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) throw new Error(updateError.message);

  try {
    await supabase.rpc('force_release_session');
  } catch {
    // best-effort - the 60s heartbeat timeout frees the slot regardless
  }

  clearLocalSessionToken();
  await supabase.auth.signOut({ scope: 'global' });
};

export const logoutSession = async (session?: AuthSession | null) => {
  if (session?.sessionToken) {
    try {
      await supabase.rpc('release_session', { session_token: session.sessionToken });
    } catch {
      // best-effort - the 60s heartbeat timeout frees the slot regardless
    }
  }
  clearLocalSessionToken();
  await supabase.auth.signOut();
};

const isSessionInvalidatedError = (error: { message?: string } | null) =>
  Boolean(error?.message?.includes('session_invalidated'));

// Trial-extension passcode only (see supabase/schema.sql). There is no
// client-side list of valid codes anymore - the database is the source of
// truth, so this can't be read out of the JS bundle.
export const redeemPasscode = async (session: AuthSession, code: string): Promise<AuthSession> => {
  const { data, error } = await supabase.rpc('redeem_passcode', { code: code.trim(), session_token: session.sessionToken });
  if (isSessionInvalidatedError(error)) throw new SessionInvalidatedError();
  if (error || !data) throw new Error('Invalid passcode. Please try again.');
  const row = data as EntitlementRow;
  return buildSession(session.user.id, session.user.email, session.user.name, session.token, session.sessionToken, row);
};

export const recordVerifyOcrPages = async (session: AuthSession, pages: number): Promise<AuthSession> => {
  const { data, error } = await supabase.rpc('record_ocr_pages', { pages, session_token: session.sessionToken });
  if (isSessionInvalidatedError(error)) throw new SessionInvalidatedError();
  if (error || !data) throw new Error(error?.message || 'Could not update OCR usage.');
  const row = data as EntitlementRow;
  return buildSession(session.user.id, session.user.email, session.user.name, session.token, session.sessionToken, row);
};
