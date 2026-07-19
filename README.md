# Admitly — Education Consultancy CRM

A responsive consultancy operations MVP for lead capture, searchable student profiles, enquiry preferences, office visitor tracking, follow-up reminders, assignments, and an interaction timeline.

## Run locally

Use Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Authentication and a working MongoDB connection are required; the product no longer contains demo contacts.

## MongoDB setup

1. Create a free MongoDB Atlas cluster and database user.
2. Copy `.env.example` to `.env.local` and set `MONGODB_URI`.
3. The `Lead` and `User` Mongoose models include duplicate phone/email protection, searchable fields, roles, branch ownership, office state, follow-ups, and activity history.
4. `GET /api/leads?q=...` and `POST /api/leads` are ready for the persistent-data integration.

## Product scope

The implemented trial covers live dashboard metrics, lead/student directory, search by personal or enquiry fields, full profile editing, persistent notes/calls, visitor check-in/out, counsellor ownership, persistent follow-ups, responsive navigation, and duplicate-safe enquiry creation.

Review [SECURITY.md](./SECURITY.md) before any public deployment.

Before production deployment, complete session authentication, authorization checks per API route, audit log retention, file storage, backups, rate limiting, and Nepal privacy/consent review. Recommended next modules are application/document checklists, university/course catalog, payments, Facebook lead webhooks, WhatsApp/SMS, exports, and branch reporting.
