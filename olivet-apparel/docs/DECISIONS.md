# Decisions

## Made

| # | Decision | Reason |
|---|---|---|
| D1 | No mock-ups; design directly in code from these docs | The owner wants the design to stay creative and not be locked to a static picture. |
| D2 | One signature concept: **"Follow the Thread"** | Unique and memorable without being distracting. |
| D3 | Booking is priority #1; showcase is #2 | The site exists to win clients. |
| D4 | **SQL (PostgreSQL)** for the database, with plain SQL queries | Owner asked for SQL; relational data fits; free hosted tiers exist. |
| D5 | Booking notifications by **email (Resend → her Gmail)** plus a **WhatsApp click-to-chat** hand-off | Instant, free, reliable. A booking is saved even if email fails. |
| D6 | AI try-on through **free open-source models on Hugging Face Spaces**, proxied by our server, behind a swappable interface | Owner wants AI features at no cost; it can be upgraded later without UI changes. |
| D7 | Style Finder and recommendations are **deterministic** (tags + SQL), with no AI | Instant, free and predictable. |
| D8 | No blog, no shop/cart and no visitor accounts in v1 | Keep it focused and uncluttered. |
| D9 | Next.js + TypeScript + Tailwind on Vercel | Fast, free hosting, and a stack the team already uses. |

## Open questions for the client

1. **What does she make?** Bridal? Braids/hair? Ready-to-wear? Aso-ebi / owambe / traditional? Menswear? Kids? This changes the categories and the Style Finder questions.
2. **Show prices?** "Starting from" prices, price ranges, or "price on request"?
3. **Where are her clients?** A local city only, nationwide, or international (shipping)? Which currency?
4. **Contact details:** the booking-alert email address, the WhatsApp number, Instagram handle.
5. **Fittings:** does she have a studio address for in-person fittings, or does she work from client measurements?
6. **Turnaround:** typical lead time, and does she offer rush orders?
7. **Brand assets:** an existing logo or colours? Is "olive gold" OK as the thread accent?
8. **Photos:** does she have sketches and fitting photos (not only final shots)? The timeline feature is strongest with them, and she can start saving them now.
9. **Domain:** e.g. `olivetapparel.com`. Is it purchased?
10. **Deposits:** does she want online deposit payments later (Paystack/Flutterwave/Stripe)?
