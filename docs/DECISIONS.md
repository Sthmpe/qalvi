# Qalvi Decision Log

## 2026-09-19 — Project created

Working product name: Qalvi.

## Framework

Decision:
Use Next.js rather than Flutter Web.

Reason:
Qalvi is primarily a web SaaS with public interview links, realtime voice, dynamic React components, charts, SEO pages and server APIs.

## Voice

Decision:
Live voice is part of V0/V1 rather than a later feature.

Technology:
LiveKit.

Reason:
Conversation quality is central to the product experience.

Participants should also be able to type.

No camera required.

## AI

Decision:
Start with Groq due to low/free initial cost.

Architecture must allow other AI providers later.

## Research Philosophy

Decision:
Qalvi should not simply automate questionnaires.

It must conduct adaptive qualitative research while remaining neutral and evidence-driven.

## Visuals

Decision:
AI may request predefined visual components.

AI must not generate arbitrary frontend scripts during interviews.

## First Study

Decision:
Korra will be the first real study.

Korra-specific logic must not be built into Qalvi's core architecture.

## Product Position

Current hypothesis:

Qalvi is not simply an AI interview tool.

It is an AI-powered PMF/customer-research experimentation platform capable of combining conversation with live interactive concept testing.

This positioning remains a hypothesis and should change if user evidence suggests otherwise.