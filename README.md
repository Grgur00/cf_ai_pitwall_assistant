# Pitwall — Cloudflare Workers AI + Durable Objects 

**Pitwall** is an AI-assisted race engineering chat assistant built on **Cloudflare Workers AI**, using
**Durable Objects** for per-session memory and **KV** for persistence.  
The UI is designed in a bold *neobrutalist* style, optimized for clarity and fun.

This project was created as a Cloudflare AI App assignment.

---

## Features

| Component | Technology | Purpose |
|----------|------------|---------|
| **LLM** | Cloudflare **Workers AI** (`@cf/meta/llama-3.1-8b-instruct`) | Generates responses and reasoning |
| **Memory / Session State** | **Durable Objects** | Long-running, isolated per-chat context |
| **Global State** | **KV** (optional) | Conversation archiving / shared notes |
| **Frontend** | Plain HTML/CSS/JS | Lightweight and responsive chat interface |
| **Voice Input** | Web Speech API | Hands-free message input |

---

## Demo Behavior

- Each **Session ID** maps to one **Durable Object instance** (so conversation memory persists).
- Clicking **New Session** resets context.
- Messages are stored and trimmed to keep context lightweight.
- UI supports **Ctrl/⌘ + Enter** to send messages.
- Optional **voice-to-text** input is supported in Chrome.

---

## Project Structure

```
cf_ai_pitwall_assistant/
├─ src/
│  └─ worker.ts           # Worker entry — also exports SessionDO
├─ public/
│  ├─ index.html          # Neobrutalist UI chat page
│  └─ style.css
├─ wrangler.toml          # Cloudflare config (KV + Durable Objects + AI binding)
├─ PROMPTS.md             # System prompt + guiding behavior
└─ README.md              # This file
```

---

## Setup & Run

### 1) Install tools
```bash
npm install -g wrangler
wrangler login
```

### 2) Install dependencies
```bash
npm install
```

### 3) Create KV namespace
```bash
wrangler kv namespace create CHAT_KV
wrangler kv namespace create CHAT_KV --preview
```
Paste these IDs into `wrangler.toml`.

### 4) Create Durable Object (Free plan requires sqlite DO)
Ensure `wrangler.toml` contains:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["SessionDO"]
```

### 5) Deploy (required at least once to initialize the Durable Object)
```bash
wrangler deploy
```

### 6) Run in Remote Dev mode (to use Workers AI binding)
```bash
wrangler dev --remote --assets ./public
```

Visit:
```
http://127.0.0.1:8787
```

---

## Deployment

```bash
wrangler deploy
```

You will receive a public URL such as:
```
https://cf_ai_pitwall_assistant.grgurinovic-a.workers.dev/
```

---


## 📄 PROMPTS.md

The assistant is guided to:
- Be concise
- Use bullet points for advice
- State assumptions
- Avoid hallucination when data is missing

---

## Credits

Built with:
- Cloudflare Workers
- Workers AI (Llama 3.1)
- Durable Objects
- KV Storage
- HTML/CSS/JS 

---

## 🏁 License

MIT — free to use, modify, and remix.

---

> "It's like having a track engineer in your terminal — without yelling in your headset."
