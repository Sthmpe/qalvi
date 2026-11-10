# Experience

There are intentionally no mock-ups. This document describes intent, structure and feel, so the visual design can stay creative during the build instead of being locked to a static picture.

## Site map (v1)

```
/                     Landing: the thread begins
/collections          All work, filterable by occasion + Swatch Drawer
/collections/[slug]   One collection (e.g. "Bridal 2026", "Owambe Edit")
/looks/[slug]         One piece: timeline, details, try-on, "Book this look"
/style-finder         4-question visual quiz → matching looks
/atelier              About the designer, process, the Atelier Wall
/book                 Booking request form (pre-filled from any look)
/book/thank-you       Confirmation + WhatsApp shortcut
/studio               Private admin (designer only)
```

## Landing page, scene by scene

1. **Opening.** Near-full-screen, a single hero image or short silent video loop of her best piece. The wordmark "Olivet Apparel" sits small and confident. A needle pierces the bottom edge of the screen and the thread starts.
2. **Statement.** One line in large serif type, e.g. *"Clothes that are made for one person: you."* (final copy from the client).
3. **Signature pieces.** 3–5 hero looks laid out like pinned fabric on a studio wall, slightly asymmetric. The thread loops through each one. Hover or tap reveals the name and the occasion.
4. **The process.** One featured piece's Sketch → Fabric → Fitting → Final timeline, scrubbable. This is the moment that sells the craft.
5. **Swatch Drawer teaser.** A row of fabric swatches. Tapping one opens `/collections` filtered by that fabric.
6. **Atelier Wall teaser.** Real clients, real occasions, short quotes.
7. **Find your style.** An invitation to the Style Finder or the AI try-on.
8. **The thread ends.** It ties into a simple booking call-to-action: *"Let's make yours."* Below it: the WhatsApp, Instagram and email links.

## Look page (`/looks/[slug]`)

- Large imagery, swipeable on mobile.
- The **timeline slider** (sketch → final). Stages are optional per look.
- Details: occasion, fabric, silhouette, colour options, typical turnaround, "starting from" price (optional; client decides).
- **"Wear it"** opens the AI try-on modal.
- **"Book this look"** is sticky on mobile and goes to `/book?look=slug`.
- "You may also love": 3 related looks, chosen by shared tags (deterministic).

## Booking flow (`/book`)

Short, warm, one screen on desktop and stepped on mobile:

1. **The look**: pre-filled thumbnail(s) if they came from a look, otherwise optional picks from the portfolio, plus an upload for inspiration photos.
2. **The occasion**: type, event date, and whether they need it delivered or will pick it up.
3. **Fit**: choose "Book a fitting / measurements in person" or "I'll send my measurements" (guided fields).
4. **You**: name, phone (WhatsApp), email, preferred contact method, budget range, notes.
5. **Send**: the request is saved to the database, the designer gets an email immediately, the client gets a confirmation email, and the thank-you page offers *"Continue on WhatsApp"* with the details pre-typed.

## Design language

| Element | Direction |
|---|---|
| **Palette** | Warm ivory/bone background, deep ink (near-black) text, *one* accent for the thread: olive gold, a nod to the name "Olivet". Images bring the colour. |
| **Type** | An elegant high-contrast serif for display (e.g. Cormorant / Playfair-class, free via Google Fonts) paired with a clean, quiet sans for body text. |
| **Layout** | Generous whitespace, asymmetric editorial grids, and images that break the grid on purpose. |
| **Motion** | Slow, smooth and physical: thread drawing, gentle parallax on fabric, soft fades. No bouncing, spinning or noisy effects. All motion respects `prefers-reduced-motion`. |
| **Texture** | A very subtle linen/paper grain on backgrounds, so the site feels like a studio, not a screen. |
| **Dark mode** | An "evening" mode (ink background, ivory text, gold thread) that is especially good for bridal and evening wear. |

## Accessibility and performance targets

- WCAG AA contrast, full keyboard support, alt text on every image (required in the admin).
- Lighthouse ≥ 90 on mobile. Images are served as responsive AVIF/WebP and lazy-loaded.
- The site works without JavaScript for browsing and for the booking form (progressive enhancement). The thread is decoration only.

## Admin, "The Studio" (`/studio`)

A private, password-protected area for the designer only:

- Add or edit looks: upload images per timeline stage, set tags (occasion, fabric, colour, silhouette), publish or hide.
- Manage collections and fabric swatches.
- View booking requests, change their status (new → contacted → fitting booked → in progress → delivered), and add private notes.
- Approve Atelier Wall photos and testimonials.
