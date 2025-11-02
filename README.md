# Pitwall — Cloudflare Workers AI + Durable Objects

Pitwall is a race engineering and strategy assistant built on Cloudflare Workers.
It combines LLM-based reasoning, telemetry analysis, and stint strategy modeling into a unified interface.
Each user session maintains state using Durable Objects, allowing context to persist across multiple interactions.

The interface is intentionally minimal and high-contrast, modeled after traditional trackside tool layouts.

---

## Features

| Component | Technology | Purpose |
|----------|------------|---------|
| Large Language Model | Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`) | Provides reasoning and explanation |
| Persistent Session Memory | Durable Objects | Stores conversation state, telemetry summaries, and last strategy results |
| Storage (Optional) | Cloudflare KV | Can archive historical sessions |
| Telemetry Analysis | CSV ingestion + statistical computation | Extracts min/max/mean/std, detects anomalies, and surfaces trends |
| Strategy Simulator | Lap-by-lap performance model | Models pit stops, tire degradation, fuel mass effects, and SC events |
| Frontend | HTML/CSS/JS | Clean neobrutalist design focused on readability |

---

## Functional Behavior

- Each **session** maps to a single **Durable Object instance**, providing continuity in reasoning.
- Uploading telemetry stores its computed summary and makes it available for follow‑up questions.
- Running a strategy simulation updates the session state with the latest stint model.
- The assistant can reference telemetry and strategy results directly in conversation.

Example follow-ups:
- "Compare tire degradation between stints based on the last uploaded telemetry."
- "If we pit two laps earlier, how does total race time change?"
- "Is there a risk of fuel starvation near the end of stint 3?"

---

## System Architecture

```
┌──────────────────────────────┐       ┌──────────────────────────────┐
│          Browser UI          │       │        Cloudflare KV         │
│  HTML + CSS + JS + SVG       │◄──────┤  (Optional global storage)  │
└──────────────┬───────────────┘       └──────────────────────────────┘
               │  fetch / events
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Worker                           │
│  - Routes API calls                                                 │
│  - Calls Workers AI model                                           │
│  - Directs requests to session state                                │
└───────────────────┬─────────────────────────────────────────────────┘
                    │ Durable Object Mapping (sessionId → instance)
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Session Durable Object                      │
│  - Maintains conversation memory                                     │
│  - Stores last telemetry dataset                                      │
│  - Stores last race strategy evaluation                               │
│  - Ensures isolated per-driver/per-session context                    │
└─────────────────────────────────────────────────────────────────────┘

```

Key principle: **each session preserves its own reasoning state**, enabling incremental analysis across runs, stints, and track evolution.

---

## Project Structure

```
pitwall/
├─ src/
│  └─ workers.ts            # Worker logic (chat, telemetry, strategy, DO)
├─ public/
│  ├─ index.html            # UI
│  ├─ style.css             # Neobrutalist visual theme
│  └─ script.js             # Client logic, charts, telemetry renderer
├─ wrangler.toml            # Cloudflare bindings config
└─ README.md
```

---

## Telemetry Workflow

1. User uploads a `.csv` telemetry dataset.
2. The Worker parses data and computes:
   - minimum, maximum, mean, standard deviation
   - trend estimation
   - outlier count
3. The UI displays per-signal tiles and sparkline plots.
4. The assistant provides contextual engineering interpretation.
5. Summary is stored and remains available for strategic analysis.

---

## Strategy Simulation Workflow

1. User specifies:
   - Total laps
   - Base lap time
   - Fuel burn rate
   - Tire degradation per lap
   - Pit stop time loss
   - Stint structure
   - Optional safety car lap
2. The model computes lap pace, fuel curve, pit markers, total time feasibility.
3. Results are visualized and stored in session memory.
4. The assistant provides tactical recommendation based on output.

---

## Setup

### 1. Install
```bash
npm install -g wrangler
wrangler login
```

### 2. Dependencies
```bash
npm install
```

### 3. Create KV namespaces
```bash
wrangler kv namespace create CHAT_KV
wrangler kv namespace create CHAT_KV --preview
```

### 4. Enable Durable Object storage
In `wrangler.toml`:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["SessionDO"]
```

### 5. First deploy (required to initialize DO)
```bash
wrangler deploy
```

### 6. Development (uses Workers AI remotely)
```bash
wrangler dev --remote --assets ./public
```

Open:
```
http://127.0.0.1:8787
```

---

## Deploy

```bash
wrangler deploy
```

Example public URL:
```
https://cf_ai_pitwall_assistant.grgurinovic-a.workers.dev/
```

---

## Prompt Behavior

The assistant is guided to:
- Answer concisely
- Use structured reasoning
- State assumptions when data is incomplete
- Avoid inventing information not present in telemetry or strategy state

---

## License

MIT — free to use and modify.


> "It's like having a track engineer in your terminal — without yelling in your headset."
