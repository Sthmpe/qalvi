# Vision

## The client

Olivet Apparel is a fashion designer's label. The site's job is to make a prospective client think, within seconds:

> "This person is exceptional. This person can make *my* outfit. I want to book her."

Her work is likely custom and made-to-measure (possibly bridal and occasion wear, possibly ready-to-wear too; see open questions in `DECISIONS.md`).

## The three jobs of the site

| Priority | Job | Success looks like |
|---|---|---|
| 1 | **Book** | A visitor picks a style and sends a booking request in under 2 minutes. The designer gets it by email immediately. |
| 2 | **Showcase** | The work looks expensive, deliberate and personal, never like a template. |
| 3 | **Convince** | Process, craft and real client results build trust before the visitor ever messages her. |

The site has no blog, no shop or cart in v1, no user accounts for visitors, and nothing loud or confusing.

## The big idea: "Follow the Thread"

Most fashion portfolios are a grid of photos. Ours is built around one signature metaphor: **a single thread**.

- A fine thread (gold, or the brand's accent colour) is drawn across the screen as you scroll. It **stitches** each section to the next, so the whole site feels sewn together, like a garment.
- Wherever the thread passes a piece of work, it pulls you into that piece's story.
- The thread ends at the booking form. Visitors *literally follow the thread to their own outfit*.

It's one idea, done well and used everywhere, so the site feels unique without becoming noisy. Every other effect stays quiet so the thread and the clothes stay the stars.

## What makes people say "wow, I wouldn't have thought of that"

1. **Sketch → Fabric → Fitting → Final.** Each piece has a scrubbable timeline. Drag the slider and the image morphs from her pencil sketch to the fabric swatch, to the fitting, to the finished photo. Clients see the *craft*, not just the result.
2. **The Swatch Drawer.** A tactile row of fabric swatches. Tap a fabric and the collection filters to pieces made from it. Shoppers browse by *feel*, not just category.
3. **"Wear it" AI try-on (free).** Upload a photo and see a chosen style on yourself. Built on free, open-source virtual try-on models (see `ARCHITECTURE.md`).
4. **The Style Finder.** Four visual questions (occasion, silhouette, colour mood, budget range) lead to curated looks from her portfolio. No AI cost here: it's deterministic matching.
5. **Booking that remembers your taste.** Every "Book this look" button carries the chosen piece (plus try-on image and Style Finder answers, if any) straight into the booking form. The designer receives a request that already says *exactly* what the client wants.
6. **The Atelier Wall.** Real clients wearing their finished pieces, each linked back to the original design and its timeline. Social proof that's tied to the work.

## Design direction (summary)

Premium, editorial, calm and confident. Think *a couture house's private studio*, not a dashboard and not a magazine clone. See `EXPERIENCE.md` for detail.

## Guiding principles

- **Clothes first.** Every UI decision should make the garments look better.
- **One signature, total restraint.** The thread is the only "show-off" element.
- **Never lose a lead.** Every page is at most one tap from booking or WhatsApp.
- **Fast on a phone.** Most clients will arrive from Instagram/WhatsApp on mobile data.
- **Free to run.** Every service in v1 has a free tier that covers a single designer's traffic.
- **Easy for her to update.** She should be able to add a new piece without a developer.
