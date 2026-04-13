# Troopod — Ad Landing Page Personalizer

> AI-powered tool that takes an ad creative + landing page URL and generates a CRO-optimized personalized landing page instantly.

**Live Demo:** [troopod-demo-last.vercel.app](https://troopod-demo-last.vercel.app)

---

## What It Does

You input:
1. **An ad creative description** — headline, tone, visuals, CTA, audience
2. **A landing page URL** — the existing page you want to personalize

You get:
- Side-by-side comparison of the original page vs personalized version
- Full rendered personalized landing page (open full screen)
- Ad analysis breakdown — category, tone, CTA, key message
- CRO changes list explaining every improvement made

---

## How It Works

```
Ad Description + Landing Page URL
         ↓
   Fetch Landing Page
   Extract Signals (title, h1, h2, paragraphs)
         ↓
   Call 1 — Ad Analyzer (Groq, Llama 3.3 70B)
   → Detects category, tone, brand, key message
         ↓
   Call 2 — CRO Copywriter (Groq, Llama 3.3 70B)
   → Rewrites copy to match ad messaging
         ↓
   Dual Output Mode:
   ├── Server-rendered page → Inject copy into real HTML
   └── SPA / blocked page  → Generate branded mockup
         ↓
   Personalized Page Output
```

---

## Key Features

- **Two-call AI architecture** — separate analysis and copy generation for accuracy
- **Dual output mode** — real page enhancement for accessible sites, branded mockup fallback for SPAs
- **CRO best practices** — message match, urgency, benefit-focused copy, tone consistency
- **11 ad categories** with matching images and brand colors
- **XSS sanitization** on all AI output
- **Rate limiting** — 5 requests/min per IP
- **Retry logic** — validates AI output, retries once on failure

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 |
| Backend | Vercel Serverless Functions |
| AI Model | Groq — Llama 3.3 70B Versatile |
| Hosting | Vercel (free tier) |

---

## Project Structure

```
pages/
  index.js          ← Frontend UI
  api/
    personalize.js  ← Main API — fetches page, runs AI, returns personalized HTML
styles/
  Home.module.css   ← Styles
package.json
```

---

## Assumptions

- Ad input is text description (image upload planned for V2 via Gemini Vision)
- Most major sites (Swiggy, Nike, Amazon) are SPAs — system falls back to branded mockup
- Personalized output is an HTML preview, not a deployed live page
- Production V2 would use JS injection for live page personalization

---

## Assignment

Built for the **Troopod AI PM Assignment** — demonstrating AI agent design, CRO principles, and end-to-end product thinking.

*Submitted by Himanshu Kumar*
