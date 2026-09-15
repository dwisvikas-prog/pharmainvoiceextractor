import { createClient } from '@supabase/supabase-js';

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

export const PLAN_PRICING = {
  basic: {
    monthly: 354,
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
  active_session_token: string | null;
};

export const getVerifyOcrLimit = (plan: PlanId) => VERIFY_OCR_PAGE_LIMITS[plan] ?? VERIFY_OCR_PAGE_LIMITS.trial;

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

export type AccessBlockReason = 'ok' | 'expired' | 'ocr_limit';

export const getAccessBlockReason = (session: AuthSession): AccessBlockReason => {
  if (isPlanExpired(session)) return 'expired';
  if (isOcrLimitReached(session)) return 'ocr_limit';
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
  ocrPeriodKey: row.ocr_period_key
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
