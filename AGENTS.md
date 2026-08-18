# Repository Guidelines

## Project Structure & Module Organization

The Vite entry point in `src/main.tsx` mounts the single-page React application in `src/App.tsx`. `App.tsx` owns upload flows, PDF/image processing, OCR selection, editable ERP data, and Excel/CSV export. Keep reusable PDF rendering and text extraction logic in `src/utils/pdfExtraction.ts`; keep OCR providers, parsing, and the `ErpRow`/`InvoiceHeader` data model in `src/utils/ocr.ts`. The canonical 34-column ERP schema and header aliases live in `src/utils/constants.ts`, and table or metadata UI belongs in `src/components/`.

The optional Python service is isolated in `backend/`. `backend/main.py` exposes FastAPI health and invoice-extraction routes, using `pdfplumber` to build structured metadata and item rows. Its pinned Python dependencies are in `backend/requirements.txt`.

## Build, Test, and Development Commands

- `npm run dev` starts the Vite development server.
- `npm run build` runs TypeScript checking and creates the production Vite bundle.
- `npm run preview` serves the built frontend locally.
- `pip install -r backend/requirements.txt` installs the Python service dependencies.
- `python backend/main.py` starts the FastAPI service on port 8000.

No test command or test suite is currently configured. Use `npm run build` as the available frontend validation after TypeScript changes. This project has no defined single-test command.

## Coding Style & Naming Conventions

TypeScript is configured with `strict`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`; production TypeScript should satisfy these checks. The project uses React function components and Tailwind utility classes. Use PascalCase for React component filenames and exports, camelCase for functions and state, and place invoice-domain types and parsing helpers with the relevant utility module. Keep ERP column keys consistent with `ERP_COLUMNS` rather than duplicating string variants.

No formatter, linter, pre-commit hook, or additional agent-instruction file is configured.

## Commit & Pull Request Guidelines

The available history contains one concise, imperative-style commit: `Initial React project`. Follow that pattern with a short summary focused on the change. There is no pull-request template in this repository. Describe frontend versus backend impact and confirm the relevant build or service check in the pull request.
