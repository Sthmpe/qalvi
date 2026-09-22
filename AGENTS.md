# Qalvi — Agent Instructions

Qalvi is an AI-powered conversation and research platform for founders, product teams, researchers, sales teams, agencies, and other teams. It is not a personal assistant or recruitment/job-interview product.

Raw interview evidence is the source of truth. Derived findings never replace it. Preserve: Study → Participant → Conversation → Raw Evidence → Derived Findings.

Before making any code or architecture changes, read:

- docs/PRODUCT.md
- docs/ARCHITECTURE.md
- docs/INTERVIEW_ENGINE.md
- docs/ROADMAP.md
- docs/DECISIONS.md

These documents are the current source of truth.

## Rules

1. Do not redesign the product without explicit approval.
2. Do not add dependencies unless required for the current task.
3. Do not replace the agreed technology stack without approval.
4. Keep the product reusable for multiple founders/studies.
5. Never hard-code Qalvi around the Korra study.
6. Korra is only the first study used to test Qalvi.
7. AI must not generate arbitrary executable frontend code during interviews.
8. Calculations must be performed by deterministic application code where possible.
9. Visuals must be rendered using predefined reusable React components.
10. Keep participant interview UX fast, simple and mobile-friendly.
11. Preserve raw interview evidence. AI summaries must remain traceable to source responses.
12. Do not build features outside the current ROADMAP milestone.
13. Before large refactors or architecture changes, explain the proposed change first.
14. Keep API secrets server-side.
15. Never expose Groq, LiveKit, Supabase service-role, or other private keys to the browser.
16. UI work must follow the premium, modern and restrained design direction defined in docs/PRODUCT.md. Do not default to generic dashboard or chatbot styling.

## Current Stack

- Next.js
- TypeScript
- React
- Tailwind CSS
- Supabase
- LiveKit
- Groq initially
- Recharts
- npm

Additional AI providers may be supported later through an abstraction layer.

## Development Philosophy

Build the smallest complete working vertical slice first.

Voice/text interview
→ AI interviewer
→ interactive visual
→ transcript
→ stored interview evidence.

M2.5 adds a local-data researcher/team UI shell while preserving the validated realtime interview. This does not authorize billing, authentication, team permissions, persistence, real study creation, participant marketplaces, or advanced analytics. See ROADMAP for the exact active scope.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
