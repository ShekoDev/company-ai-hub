<div align="center">

# 🧠 Company AI Hub
### One gateway for OpenAI, Gemini, Claude & NVIDIA NIM — with streaming, cost tracking and unified errors

![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?logo=openai&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-8E75B2?logo=googlegemini&logoColor=white)
![Claude](https://img.shields.io/badge/Claude-D97757?logo=anthropic&logoColor=white)
![NVIDIA](https://img.shields.io/badge/NVIDIA_NIM-76B900?logo=nvidia&logoColor=white)

</div>

---

## 📌 Overview

Phase 1 of an internal **AI platform for a company's employees**: a single, provider-agnostic **AI Gateway** so every app in the company talks to *one* API — no matter which model is behind it.

```ts
// identical code for every provider — only `model` changes
const res = await gateway.chat({ model: 'claude-balanced', messages }, { userId });
for await (const e of gateway.stream({ model: 'gpt-fast', messages }, ctx)) { … }
```

## ✨ Design highlights

- 🔌 **Adapter pattern** — each provider implements one shared contract (`types.ts`)
- 🏷️ **Stable internal model IDs** (`claude-balanced`, `gpt-fast`) — upgrading a provider's model never breaks permissions or UI
- 💸 **Model registry with pricing** → per-request **cost in USD** + token usage
- 🌊 **SSE streaming** with errors delivered as events (the HTTP status is already sent)
- 🛡️ **Access guard runs before any paid call** (permissions / time-based sessions)
- 🔒 Keys and provider model names **never reach the browser**; OpenAI `store: false`
- 🇸🇦 Employee-facing error messages in Arabic, internal details only in logs
- 🧪 `npm run test:ai` — live adapter tests: reply, streaming, tokens, cost, AbortSignal

## 🗂️ Structure

```
src/lib/ai/
├── types.ts       shared contract
├── errors.ts      unified error codes
├── models.ts      model registry + pricing + cost
├── gateway.ts     single entry point + access guard
└── adapters/      openai · gemini · claude · nvidia
src/app/api/chat     POST — SSE streaming or JSON
src/app/api/models   GET  — available models
```

## 🚀 Getting Started

```bash
npm install
cp .env.example .env   # add your provider keys (server-side only)
npm run test:ai
npm run dev
```

Original design notes (Arabic): **[docs/DESIGN_AR.md](docs/DESIGN_AR.md)**

---

## 👤 Author

**Mahmoud Shahab** — AI Department Manager · AI Automation & Operations
Building AI-powered systems that turn messy operations into clear, trackable workflows.

[![LinkedIn](https://img.shields.io/badge/LinkedIn-mahmoud--shahab--ai-0A66C2?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/mahmoud-shahab-ai)
[![GitHub](https://img.shields.io/badge/GitHub-ShekoDev-181717?logo=github)](https://github.com/ShekoDev)

© Mahmoud Shahab — All rights reserved.
