# Hiremote Operations Portal

Role-based workspace for Hiremote employees, Iron Hand managers, and client partners. Employees upload end-of-shift packages, Iron Hand staff submit structured reports, and clients (plus HQ) can filter, preview, and download every asset captured for their stores. Learn more about Hiremote at [Hiremote.co](https://hiremote.co).

## Quick start

```bash
npm install
npm run dev
# app runs on http://localhost:3000
```

Uploads are saved to `public/uploads` and metadata is stored in `data/storage.json`. These files remain local—wire up S3/Azure/etc. when you’re ready for production storage.

## Demo accounts

| Role            | Email                 | Password   | Notes                  |
| --------------- | --------------------- | ---------- | ---------------------- |
| Employee        | ava@hiremote.com      | shift123   | Store 101              |
| Employee        | luca@hiremote.com     | shift456   | Store 202              |
| Iron Hand (HQ)  | nia@ironhand.com      | report789  | Uploads + filtering    |
| Client (Store)  | amber@clientstore.com | client101  | Store 101 visibility   |
| Client (Store)  | jacob@clientstore.com | client202  | Store 202 visibility   |

## Feature guide

- **Authentication** – email/password mock auth with signed HTTP-only cookie, managed in `src/lib/auth.ts`.
- **Employees** – submit scratcher video, cash photo, sales report photo + optional notes. Files stored on disk; metadata auto-tags employee/store/timestamp.
- **Iron Hand** – upload Daily (text + optional media), Weekly (text or doc/photo), and Monthly (doc) reports from `src/components/ironhand/IronHandReportForm.tsx`.
- **Clients & HQ** – gallery in `RecordsPanel` merges shift packages + reports. Filter by store, category, employee, or date range, then open/zoom/download attachments.
- **API routes** – see route handlers in `src/app/api/*` for auth, uploads, report ingest, and combined record retrieval.

## Next steps

- Replace mock auth with your identity provider (Auth0, Cognito, etc.).
- Swap the JSON/FS persistence layer with a database + object storage (Supabase, Postgres, DynamoDB, S3, …).
- Enforce file size limits / virus scanning, and move uploads to presigned URLs for production use.
- Add notifications or approval workflows around new reports if needed.
