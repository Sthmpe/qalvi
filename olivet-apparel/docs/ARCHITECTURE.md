# Architecture

Goal: a **premium, fast site with a real backend that costs ₦0 / $0 per month** at a single designer's traffic, and that can grow later without a rewrite.

## Stack

| Layer | Choice | Why | Free tier |
|---|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Pages, server actions and API routes in one project. Great image optimisation. | n/a |
| Styling | **Tailwind CSS** | Fast to build a custom (non-template) look with design tokens. | n/a |
| Motion | **CSS + a small amount of Motion (framer-motion)**; SVG `stroke-dashoffset` for the thread | Smooth, controllable animation; the thread is plain SVG. | n/a |
| Database | **PostgreSQL (SQL)**, hosted on **Neon** or **Supabase** | Real SQL, as requested. Relational data (looks ↔ tags ↔ bookings) fits naturally. | Both have generous free tiers |
| DB access | **Plain SQL via a tiny query layer** (`postgres` / `@neondatabase/serverless`), with migrations as `.sql` files | Keeps it simple and transparent: "we just use SQL". | n/a |
| Images | **Cloudinary** (or Supabase Storage) | Auto-resize, AVIF/WebP, crops for the timeline slider. | Cloudinary free: ~25 credits/mo |
| Email | **Resend** (via a server action), with Gmail SMTP + Nodemailer as a fallback | Sends booking alerts straight to her Gmail and a confirmation to the client. | Resend free: 3,000 emails/mo |
| WhatsApp | **`wa.me` click-to-chat links** with pre-filled text | Instant, free, no API approval needed. | Free |
| AI try-on | **Open-source virtual try-on on Hugging Face Spaces** (see below) | Free. No paid AI API. | Free (queued, rate-limited) |
| Hosting | **Vercel** | Zero-config Next.js, global CDN, preview links per change. | Hobby plan free |
| Bot protection | **Cloudflare Turnstile** on forms | Stops spam bookings without annoying CAPTCHAs. | Free |
| Analytics | **Vercel Web Analytics** or **Umami** | Privacy-friendly; shows which looks get booked. | Free tier |

> All secrets (DB URL, Resend key, Cloudinary secret, admin password hash) stay **server-side** in environment variables. Nothing private ships to the browser.

## High-level flow

```
Visitor (phone) ──► Next.js on Vercel ──► Postgres (looks, collections, bookings)
                         │
                         ├──► Cloudinary (images)
                         ├──► Resend ──► designer's Gmail  +  client's inbox
                         ├──► Hugging Face Space (AI try-on, server-proxied)
                         └──► wa.me link ──► designer's WhatsApp
```

## Data model (summary)

Full draft in [`../db/schema.sql`](../db/schema.sql).

- `collections`: named groups of looks (e.g. "Bridal 2026").
- `looks`: one design: title, slug, story, occasion, silhouette, starting price, published flag.
- `look_media`: images per look, each with a `stage` (`sketch`, `fabric`, `fitting`, `final`, `detail`) and an order.
- `fabrics`: swatches for the Swatch Drawer (name, swatch image, description).
- `look_fabrics`, `look_tags`: many-to-many links that power filters, "you may also love" and the Style Finder.
- `bookings`: every request: contact details, occasion, event date, fit option, measurements (JSON), budget range, notes, status, source look(s).
- `booking_looks`, `booking_attachments`: links to chosen looks, inspiration uploads and try-on images.
- `testimonials`: Atelier Wall entries, linked to a look and needing approval before they show.
- `tryon_jobs`: a light log for rate-limiting and debugging AI try-on (no photos kept long-term).

## Booking → email pipeline

1. The form posts to a **server action**, which validates the input (zod) and checks Turnstile.
2. It inserts the `bookings` row and links in one SQL transaction.
3. It sends two emails through Resend:
   - **To the designer** (her Gmail): subject `New booking: {name} · {occasion} · {event date}`, with look thumbnails, all details, and one-tap buttons to *Reply on WhatsApp* and *Open in Studio*.
   - **To the client**: a branded "We've received your request" email with a summary and the expected response time.
4. If the email fails, the booking is **still saved** (the email is retried, and the booking shows in `/studio`). A lead is never lost.
5. The thank-you page shows a `wa.me/<her number>?text=...` button with the booking reference pre-typed.

## AI try-on: free by design

Paid try-on APIs charge per image. The plan avoids that:

- **Primary:** call a public, open-source virtual try-on model hosted on **Hugging Face Spaces** (IDM-VTON / OOTDiffusion / Kolors-Virtual-Try-On class models) through `@gradio/client`, **from our server**, so the visitor's browser never talks to third parties directly.
  - Input: the visitor's photo plus the look's "garment" image (a clean flat or mannequin shot that she uploads per look in the Studio).
  - Output: a try-on image shown in the modal, with "Book this look with this image" attached to the booking.
- **Limits and honesty:** free Spaces queue requests and can be slow (roughly 20–90 s) or temporarily down. The UI shows a beautiful "stitching your look…" state and degrades gracefully: *"Our fitting room is busy, so try again shortly, or book and we'll style it for you."*
- **Upgrade path:** if traffic grows, duplicate the Space onto our own (free CPU or cheap GPU) Hugging Face account, or swap in a paid provider behind the same `TryOnProvider` interface. No UI change is needed.
- **Privacy:** photos are processed in memory, are not stored unless the visitor attaches the result to a booking, and are covered by a clear consent line on upload.
- **Scope note:** try-on works best for tops, dresses and full outfits shown on a clean background. Intricate pieces (heavy beading, very structured bridal) may render imperfectly, so it's positioned as *"preview the vibe"*, not a fitting.

The **Style Finder** uses no AI at all. It scores looks against the quiz answers using their tags in plain SQL, so it is instant, free and predictable.

## Admin auth

There's one admin user. `/studio` is protected by a password (stored as a bcrypt hash in env), with signed, httpOnly session cookies and rate-limited login. No visitor accounts in v1.

## Project layout (planned)

```
olivet-apparel/
  app/
    (site)/              public pages
    studio/              admin
    api/tryon/           server proxy to the try-on model
  components/
    thread/              the signature SVG thread
    timeline/            sketch→final slider
    swatch-drawer/
    booking/
  lib/
    db.ts                SQL client
    queries/             one file per table/feature, plain SQL
    email/               Resend templates (React Email)
    tryon/               TryOnProvider interface + HF implementation
  db/
    schema.sql
    migrations/
  docs/
```
