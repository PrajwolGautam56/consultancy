# Admitly security and production deployment

## Implemented application controls

- Passwords are stored as bcrypt hashes (cost 12), never plaintext.
- Authentication uses an 8-hour signed JWT in an `HttpOnly`, `SameSite=Lax`, production-`Secure` cookie.
- The page proxy protects all application pages and APIs; API routes also verify the session independently.
- Login errors do not reveal whether an email exists.
- Login and lead endpoints have basic per-IP throttling. This is process-local defense-in-depth; enforce distributed limits at Vercel WAF or a shared Redis store in production.
- Mutating requests require a matching `Origin` and `Host` to reduce CSRF risk.
- Zod allowlists API fields, types, lengths, stages and sources. Mongo updates use `$set` rather than accepting arbitrary operators.
- Duplicate phone/email indexes and checks prevent common record collisions.
- Receptionists are limited to visit state and activity notes; higher roles can edit lead data.
- Security headers disable framing, MIME sniffing, unnecessary device APIs and cross-origin window access. CSP restricts resources to the application origin.
- Mongo connection pooling is capped to reduce serverless connection exhaustion.
- Demo data has been removed. CRM data is loaded from MongoDB only.

## Deployment architecture decision

Do not run two independent public copies of the same Next.js application on Vercel and Railway. That doubles the attack surface and creates confusing canonical URLs, cookies, logs and releases.

Recommended initial architecture:

1. Host the Next.js web application and API on **Vercel**.
2. Use **MongoDB Atlas** as the database.
3. Add **Railway** later only for a private background worker handling reminders, Facebook webhooks, queues or document processing. Do not expose that worker publicly unless required.
4. Use one production domain, force HTTPS, and configure exact production/preview environment variables separately.

An alternative is to host the whole Next.js service on Railway and use Vercel only for nothing; either single-host option is valid. Choose one public runtime.

## Mandatory launch checklist

- Rotate the MongoDB password and the current super-admin password because they were shared in conversation during development.
- Generate a new production `AUTH_SECRET` with `openssl rand -hex 32`. Never reuse local, preview and production secrets.
- Store `MONGODB_URI` and `AUTH_SECRET` as sensitive platform environment variables; never use `NEXT_PUBLIC_` for secrets.
- Create a least-privilege Atlas database user restricted to the `admitly` database. Do not use an Atlas project owner or broad admin database user.
- Remove Atlas `0.0.0.0/0`. On Railway Pro, enable Static Outbound IP and allowlist it in Atlas. On Vercel Pro/Enterprise, use Static IPs; for stricter isolation use Secure Compute/private connectivity.
- Enable Atlas MFA, backups, alerts, access history review and (where available) database auditing.
- Enable Vercel Deployment Protection for previews, WAF managed rules, rate limits on `/api/auth/login` and `/api/*`, bot/challenge rules and spend alerts.
- Set production session secret before the first deployment; changing it logs everyone out.
- Keep preview deployments on a separate database with synthetic data—never production student data.
- Restrict platform team members using least privilege and MFA. Review Vercel/Railway/Atlas access quarterly.
- Define retention and deletion rules for student PII, record consent, encrypt sensitive uploaded documents, and avoid logging phone numbers, emails, tokens or document contents.
- Add centralized error monitoring and audit alerts without sending PII.
- Test database restore, secret rotation, account deactivation and incident response before launch.

## Primary threat scenarios

| Threat | Current control | Production follow-up |
|---|---|---|
| Credential stuffing | Generic login errors, bcrypt, local throttling | Vercel/Railway edge rate limit, MFA for admins, breached-password checks |
| Session theft | HttpOnly/Secure/SameSite cookie, CSP | Shorter idle timeout, session revocation store, admin MFA |
| CSRF | SameSite cookie and origin verification | Maintain exact trusted domains if cross-origin APIs are introduced |
| XSS | React escaping, CSP, length-limited text fields | Sanitize any future rich text/HTML and scan uploads |
| NoSQL/operator injection | Zod strict schemas and explicit `$set` | Keep new endpoints allowlisted; never spread raw request bodies into queries |
| IDOR/privilege escalation | Route-level session checks and receptionist restrictions | Bind leads to branch/assignee and enforce row-level access before multi-branch launch |
| Data exfiltration | Authenticated APIs and 200-record cap | Field-level encryption for high-risk PII/documents, export permissions, audit alerts |
| Database exposure | Atlas TLS/authentication | Static egress allowlist/private endpoint, least-privilege DB user, rotate credentials |
| Serverless resource abuse | Request limits, query limits, capped pool | WAF limits, budgets, queue long-running tasks, observability alerts |
| Supply-chain vulnerability | Lockfile, lint/type/build/audit checks | Dependabot/Renovate, CI audit, pinned trusted deploy integrations |

## Known pre-production gaps

- Distributed session revocation and admin MFA are not yet implemented.
- Row-level branch/assigned-counsellor authorization requires real branch and staff management screens.
- Files/documents are not implemented; add private object storage, signed short-lived URLs, type/size validation and malware scanning before accepting uploads.
- Facebook, WhatsApp, email and SMS integrations require webhook signature verification, replay protection and secret rotation.
- In-memory throttling is not sufficient across multiple serverless instances; platform WAF or a shared rate-limit store is required.
