// Vercel serverless function: proxies OCR requests to the Gemini API.
// The API key(s) live only in server-side env vars (no VITE_ prefix), so they
// are never bundled into client-side JS and can't be read from the browser.
//
// Configure in Vercel project settings (Production + Preview + Development):
//   GEMINI_API_KEY            (required)
//   GEMINI_API_KEY_2..10      (optional extra keys for rotation on 429/503)
//   GEMINI_MODEL              (optional, default gemini-3.5-flash)
//   GEMINI_MODEL_FALLBACK     (optional, default gemini-3.5-flash-lite)

function getApiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }
  return keys;
}

import { applyCors } from './_utils.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY configuration' });
    return;
  }

  const { payload } = req.body || {};
  if (!payload) {
    res.status(400).json({ error: 'Missing payload' });
    return;
  }

  const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const fallbackModel = process.env.GEMINI_MODEL_FALLBACK || 'gemini-3.5-flash-lite';
  const modelsToTry = [primaryModel, fallbackModel];

  let lastStatus = 502;
  let lastBody = 'All Gemini models/keys exhausted';

  for (const model of modelsToTry) {
    const apiUrlBase = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      const apiKey = apiKeys[keyIndex];
      try {
        const response = await fetch(`${apiUrlBase}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const text = await response.text();

        if (!response.ok) {
          lastStatus = response.status;
          lastBody = text;
          // Rate limited/overloaded: try the next key immediately.
          if ((response.status === 503 || response.status === 429) && keyIndex < apiKeys.length - 1) {
            continue;
          }
          // Model unavailable: stop rotating keys, try the fallback model.
          if (response.status === 404) break;
          continue;
        }

        res.status(200).setHeader('Content-Type', 'application/json').send(text);
        return;
      } catch (err) {
        lastStatus = 502;
        lastBody = err instanceof Error ? err.message : String(err);
      }
    }
  }

  res.status(lastStatus >= 400 ? lastStatus : 502).json({ error: lastBody });
}
