# PHP API (Hostinger shared hosting version)

This is a parallel PHP rewrite of the `/api/*.js` Vercel serverless
functions in `../api/`, for hosting on plain PHP/MySQL shared hosting
(e.g. Hostinger Business hosting) that can't run Node.js. **The original
`api/*.js` files are untouched and keep working on Vercel** - this folder
is an alternative backend, not a replacement.

Behavior, request/response shapes, env var names, and validation logic are
kept identical to the JS versions so the existing frontend code (which
calls e.g. `apiUrl('/api/gemini-ocr')`) works against either backend
unchanged - just point `VITE_API_BASE_URL` at whichever one you deploy.

## Deploy steps

1. Upload this whole `php-api/` folder to your Hostinger hosting (e.g.
   `public_html/php-api/`), alongside or instead of the static frontend
   build.
2. Copy `.env.example` to `.env` in the same folder on the server and fill
   in real values (same values as your Vercel project's env vars - see
   `.env.example` at the project root for what each one does).
3. Make sure PHP's `curl` extension is enabled (it is on virtually all
   Hostinger PHP plans by default).
4. Set the frontend's `VITE_API_BASE_URL` to your Hostinger domain, e.g.
   `https://yourdomain.com/php-api`, then rebuild (`npm run build`) and
   upload `dist/` as usual.
5. Data still lives in the same Supabase project (Postgres + the
   `admin_*`/`apply_paid_plan` RPC functions from
   `supabase/admin_and_payments.sql`) - these PHP files talk to it over
   Supabase's REST API instead of the `supabase-js` client, so no schema
   changes are needed.

## Endpoints (identical paths/behavior to api/*.js)

- `gemini-ocr.php` - proxies OCR requests to Gemini
- `admin-login.php`, `admin-users.php`, `admin-lookup.php`,
  `admin-grant.php`, `admin-expire.php` - `/#admin` panel
- `razorpay-create-order.php`, `razorpay-verify-payment.php` - payments

## Not yet covered

Any other `api/*.js` file added to the Vercel project later needs a
matching `.php` file added here manually - this folder does not auto-sync
with `api/`.
