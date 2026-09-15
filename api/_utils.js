// Shared helpers for the admin + payment serverless functions. Vercel does
// NOT turn files starting with "_" into routes, so this stays a plain module.
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Stateless admin session token: base64url(JSON{exp}) + "." + HMAC-SHA256 of
// that payload, signed with ADMIN_TOKEN_SECRET (deliberately NOT the same
// secret as ADMIN_PASSCODE - a leaked token can't be used to derive the
// login passcode, and rotating one doesn't force-rotate the other).
// No sessions table needed - any serverless invocation can verify it alone.
const ADMIN_SESSION_MS = 2 * 60 * 60 * 1000; // 2 hours - short-lived on purpose

export function signAdminToken() {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ADMIN_SESSION_MS })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAdminToken(req) {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || !secret) return false;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (signature !== expectedSignature) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof decoded.exp === 'number' && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

// Best-effort request IP for the login-attempt audit log. Never throws.
export function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

// Logs a login attempt (success or failure) for the admin panel. Swallows
// errors on purpose - a logging failure must never block/break login.
export async function logAdminLoginAttempt(supabase, success, ip) {
  try {
    if (!supabase) return;
    await supabase.from('admin_login_attempts').insert({ success, ip });
  } catch {
    // best-effort only
  }
}

// Single source of truth for plan prices, shared by order-create (which
// charges this amount) and payment-verify (which records this amount as
// paid) - keep in sync with src/utils/auth.ts PLAN_PRICING. Amount is in
// paise (Razorpay's smallest currency unit), i.e. rupees * 100.
export const PLAN_PRICING_PAISE = {
  basic: { monthly: 354 * 100, yearly: 3000 * 100 },
  pro: { monthly: 500 * 100, yearly: 5000 * 100 },
};

// Service-role Supabase client: bypasses Row Level Security entirely. Only
// ever used inside these server-side functions, never sent to the browser.
export function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Resolves the calling app user from the Supabase access token they send in
// Authorization: Bearer <token> - used to tie a Razorpay payment to the
// actual logged-in account instead of trusting a client-supplied user id.
export async function getCallingUser(req, supabase) {
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!accessToken) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}
