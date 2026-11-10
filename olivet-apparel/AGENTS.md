# Olivet Apparel: Agent Instructions

This project is a portfolio and booking site for the fashion designer behind Olivet Apparel. Read `docs/VISION.md`, `docs/EXPERIENCE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/DECISIONS.md` before writing code. They are the source of truth.

## Rules

1. Booking is the #1 job. Never ship a change that makes booking slower or less reliable.
2. Clothes first: UI must make the garments look better, never compete with them.
3. "Follow the Thread" is the only signature effect. Keep everything else restrained.
4. No generic dashboard, template or chatbot styling. Premium, editorial and calm.
5. Mobile-first. Pages must be fast on mobile data (Lighthouse ≥ 90 mobile).
6. Respect `prefers-reduced-motion`; booking and browsing must work without JS.
7. Use SQL (PostgreSQL) with plain, parameterised queries. Never build queries by string concatenation.
8. A booking is saved before any email is sent. Email failure must never lose a lead.
9. All secrets stay server-side. Never expose DB, Resend, Cloudinary or admin secrets to the browser.
10. The AI try-on must go through the `TryOnProvider` interface and our server proxy. Don't store visitor photos unless they're attached to a booking.
11. Stay free-tier friendly. Don't add paid services without approval.
12. Don't add dependencies unless the current milestone needs them.
13. Don't build features outside the current ROADMAP milestone.
14. Every image needs meaningful alt text.
