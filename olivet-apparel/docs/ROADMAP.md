# Roadmap

Build the smallest complete, *beautiful* slice first, then layer on the wow features.

## M0: Planning ✅ (this folder)
Vision, experience, architecture, schema draft, open questions.

## M1: Foundation
- Create the Olivet Apparel repo and the Next.js + TypeScript + Tailwind project.
- Design tokens: palette, type scale, spacing, grain texture, evening (dark) mode.
- Postgres on Neon/Supabase; run `db/schema.sql` as migration 001.
- Deploy to Vercel with preview links.

## M2: The landing page and the thread
- The full landing page, scene by scene (`EXPERIENCE.md`).
- The signature SVG thread, scroll-driven, with a reduced-motion fallback.
- Seed it with placeholder looks until the client's photos arrive.

## M3: Portfolio
- `/collections`, `/collections/[slug]`, `/looks/[slug]`.
- Sketch → Final timeline slider.
- Swatch Drawer filtering.
- "You may also love".

## M4: Booking + email (the money feature)
- The `/book` form, pre-filled from any look, with inspiration uploads.
- The server action: validate, save to SQL, and email the designer and the client.
- The WhatsApp hand-off on the thank-you page.
- Turnstile spam protection.

## M5: The Studio (admin)
- Login, CRUD for looks, media stages, fabrics and collections.
- The bookings inbox with status and notes.
- Testimonial approval.

## M6: Style Finder + Atelier Wall
- The 4-question visual quiz and deterministic SQL matching.
- The `/atelier` page: story, process, Atelier Wall.

## M7: "Wear it": AI try-on
- `TryOnProvider` interface with the Hugging Face Spaces implementation.
- The upload/consent modal, the "stitching" loading state, graceful fallback.
- Attaching the try-on result to a booking.

## M8: Polish and launch
- Real copy and photography from the client.
- SEO (metadata, Open Graph images per look, sitemap), analytics.
- Accessibility and performance pass, Lighthouse ≥ 90 mobile.
- Custom domain and email sender domain (SPF/DKIM) so emails don't land in spam.

## Later (not v1)
Online deposits/payments, a ready-to-wear shop and cart, an appointment calendar, multi-language, client accounts, and an Instagram feed sync.
