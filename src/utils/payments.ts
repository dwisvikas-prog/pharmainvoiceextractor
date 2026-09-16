// @ts-nocheck
import { getAccessToken } from './auth';
import { apiUrl } from './apiBase';

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the payment widget. Check your connection and try again.'));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

export interface PayForPlanOptions {
  planId: 'basic' | 'pro';
  billingCycle: 'monthly' | 'yearly';
  name: string;
  email: string;
}

export interface PayForPlanResult {
  plan: string;
  billingCycle: string;
  expiresAt: string;
}

export async function payForPlan(options: PayForPlanOptions): Promise<PayForPlanResult> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Please log in again before paying.');

  const orderRes = await fetch(apiUrl('/api/razorpay-create-order'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ planId: options.planId, billingCycle: options.billingCycle }),
  });
  if (!orderRes.ok) {
    const err = await orderRes.json().catch(() => ({}));
    throw new Error(err.error || 'Could not start payment.');
  }
  const order = await orderRes.json();

  await loadRazorpayScript();

  return new Promise((resolve, reject) => {
    let settled = false;
    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: 'DWIS TAP',
      description: `${options.planId === 'pro' ? 'Premium' : 'Basic'} plan - ${options.billingCycle}`,
      prefill: { name: options.name, email: options.email },
      theme: { color: '#1e86bb' },
      handler: async (response: any) => {
        try {
          const verifyRes = await fetch(apiUrl('/api/razorpay-verify-payment'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              planId: options.planId,
              billingCycle: options.billingCycle,
            }),
          });
          const result = await verifyRes.json();
          if (!verifyRes.ok) throw new Error(result.error || 'Payment could not be verified.');
          settled = true;
          resolve({
            plan: result.entitlement.plan,
            billingCycle: result.entitlement.billing_cycle,
            expiresAt: result.entitlement.expires_at,
          });
        } catch (err: any) {
          settled = true;
          reject(new Error(err?.message || 'Payment could not be verified.'));
        }
      },
      modal: {
        ondismiss: () => {
          if (!settled) reject(new Error('Payment cancelled.'));
        },
      },
    });
    rzp.on('payment.failed', (response: any) => {
      settled = true;
      reject(new Error(response?.error?.description || 'Payment failed.'));
    });
    rzp.open();
  });
}
