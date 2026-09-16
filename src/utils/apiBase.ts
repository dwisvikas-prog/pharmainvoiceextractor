// When the frontend and the /api/*.js serverless functions are hosted on
// different domains (e.g. frontend on Hostinger, functions still on Vercel),
// set VITE_API_BASE_URL to the functions' origin (e.g.
// https://pharmainvoiceextractor.vercel.app). Leave it unset when frontend
// and functions share an origin (e.g. everything on Vercel) - fetches stay
// relative as before.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const apiUrl = (path: string) => `${API_BASE}${path}`;
