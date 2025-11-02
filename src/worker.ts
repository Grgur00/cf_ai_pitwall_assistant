/// <reference types="@cloudflare/workers-types" />

export class SessionDO {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private static readonly MODEL_ID = "@cf/meta/llama-3.1-8b-instruct" as any;
  private static readonly MAX_TURNS = 12;

  private static readonly LOG_KEY = "log";
  private static readonly CTX_KEY = "ctx"; // { telemetry?: {...}, strategy?: {...} }

  // Build a compact system-context string from stored ctx
  private async buildContextSystemPrompt() {
    const ctx: any = (await this.state.storage.get(SessionDO.CTX_KEY)) || {};
    const lines: string[] = [];

    if (ctx.telemetry) {
      const t = ctx.telemetry;
      // keep it short; models love concise bullet summaries
      lines.push(
        "Latest telemetry (summary):",
        `- rows: ${t.rowCount}`,
        `- columns: ${(t.headers || []).join(", ").slice(0, 160)}`,
        `- notable: ${t.notable ?? "n/a"}`,
      );
      if (t.analysisText) {
        lines.push(`- analyst notes: ${String(t.analysisText).slice(0, 360)}`);
      }
    }

    if (ctx.strategy) {
      const s = ctx.strategy;
      lines.push(
        "Latest strategy (result):",
        `- feasible: ${s.result?.feasible}`,
        `- totalTime(s): ${s.result?.totalTime}`,
        `- pits: ${s.result?.pits}`,
      );
      if (s.params) {
        const p = s.params;
        lines.push(
          `- params: base=${p.baseLapTime}s, deg=${p.tireDegradationPerLap}/lap, fuel=${p.fuelPerLap}L/lap, tank=${p.tankSize}L, pitLoss=${p.pitLoss}s, stints=${Array.isArray(p.stintPlan) ? p.stintPlan.join("+") : ""}`
        );
      }
      if (s.commentary) {
        lines.push(`- strategist notes: ${String(s.commentary).slice(0, 360)}`);
      }
    }

    if (!lines.length) return null;

    // One compact prompt
    return {
      role: "system",
      content:
        "You are Pitwall, a concise, helpful technical assistant. Use short bullet points when advising. Admit uncertainty. Keep replies ~200 words unless asked.\n\n" +
        "Use the context below only if relevant to the user’s question. Never invent values.\n\n" +
        lines.join("\n"),
    };
  }

  private async readLog(): Promise<any[]> {
    return (await this.state.storage.get(SessionDO.LOG_KEY)) || [];
  }
  private async writeLog(newLog: any[]) {
    await this.state.storage.put(SessionDO.LOG_KEY, newLog);
  }

  private async mergeContext(partial: any) {
    const current = ((await this.state.storage.get(SessionDO.CTX_KEY)) as any) || {};
    const merged = { ...current, ...partial };
    await this.state.storage.put(SessionDO.CTX_KEY, merged);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // --- Save or read context from this Session DO ---
    if (url.pathname.endsWith("/context") && request.method === "POST") {
      const body = await request.json<any>().catch(() => ({}));
      // Expect shape like { telemetry: {...} } or { strategy: {...} }
      await this.mergeContext(body || {});
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/context") && request.method === "GET") {
      const ctx = (await this.state.storage.get(SessionDO.CTX_KEY)) || {};
      return new Response(JSON.stringify({ context: ctx }), {
        headers: { "content-type": "application/json" },
      });
    }

    // --- Chat with context ---
    if (url.pathname.endsWith("/chat") && request.method === "POST") {
      const { message } = await request.json<any>();
      const text = (message ?? "").toString().trim();
      if (!text)
        return new Response(JSON.stringify({ error: "Bad message" }), {
          status: 400,
        });

      const log = await this.readLog();

      // Global behavior prompt
      const baseSystem = {
        role: "system",
        content:
          "You are Pitwall, a concise, helpful technical assistant. Use short bullet points when advising. Admit uncertainty. Keep replies under ~200 words unless asked.",
      };

      // Build optional telemetry/strategy context
      const contextSystem = await this.buildContextSystemPrompt();

      const messages = [baseSystem];
      if (contextSystem) messages.push(contextSystem);
      messages.push(...log.slice(-2 * SessionDO.MAX_TURNS));
      messages.push({ role: "user", content: text });

      const res: any = await this.env.AI.run(SessionDO.MODEL_ID, { messages } as any);
      const reply: string = res?.response ?? res?.output_text ?? "[no reply]";

      const newLog = [...log, { role: "user", content: text }, { role: "assistant", content: reply }].slice(
        -2 * SessionDO.MAX_TURNS
      );
      await this.writeLog(newLog);

      return new Response(JSON.stringify({ reply }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/history")) {
      const log = await this.readLog();
      return new Response(JSON.stringify({ history: log }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}

export interface Env {
  AI: Ai;
  CHAT_KV: KVNamespace;
  SESSION_DO: DurableObjectNamespace;
}

// -------- CSV utils (unchanged) --------
function parseCSV(csv: string) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] as any[] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const parts = line.split(",").map((x) => x.trim());
    const obj: any = {};
    headers.forEach((h, i) => {
      const v = parts[i] ?? "";
      const num = Number(v);
      obj[h] = v !== "" && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(v) ? num : v;
    });
    return obj;
  });
  return { headers, rows };
}

function statsFor(rows: any[], headers: string[]) {
  const numericCols = headers.filter((h) => rows.some((r) => typeof r[h] === "number"));
  const out: any = {};
  for (const h of numericCols) {
    const vals = rows.map((r) => r[h]).filter((x: any) => typeof x === "number") as number[];
    if (vals.length === 0) continue;
    const n = vals.length;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    const outliers: number[] = [];
    for (let i = 0; i < n; i++) {
      const z = std > 0 ? Math.abs((vals[i] - mean) / std) : 0;
      if (z >= 2) outliers.push(vals[i]);
    }
    const trend = vals[vals.length - 1] - vals[0];
    out[h] = { n, min, max, mean, std, trend, outlierCount: outliers.length };
  }
  return out;
}

function simulateStrategy(input: any) {
  const laps = Number(input.laps ?? 0);
  const base = Number(input.baseLapTime ?? 90);
  const fuelPerLap = Number(input.fuelPerLap ?? 0.12);
  const tank = Number(input.tankSize ?? 8);
  const pitLoss = Number(input.pitLoss ?? 22);
  const tireDeg = Number(input.tireDegradationPerLap ?? 0.08);
  const stints: number[] = Array.isArray(input.stintPlan) ? input.stintPlan.map((x: any) => Number(x)) : [laps];
  const safetyCarLap = input.safetyCarLap ? Number(input.safetyCarLap) : null;
  const safetyCarDelta = Number(input.safetyCarDelta ?? -7);

  let lapCounter = 0;
  let totalTime = 0;
  let pits = 0;
  let ok = true;
  for (const stintLaps of stints) {
    const fuelNeeded = stintLaps * fuelPerLap;
    if (fuelNeeded > tank) ok = false;
    for (let i = 0; i < stintLaps; i++) {
      lapCounter++;
      let lapTime = base + tireDeg * i;
      if (safetyCarLap && lapCounter === safetyCarLap) {
        lapTime -= safetyCarDelta;
      }
      totalTime += lapTime;
    }
    if (lapCounter < laps) {
      totalTime += pitLoss;
      pits++;
    }
  }
  if (lapCounter !== laps) ok = false;
  return {
    feasible: ok,
    totalTime: Number(totalTime.toFixed(3)),
    pits,
    assumptions: { base, fuelPerLap, tank, pitLoss, tireDeg, safetyCarLap, safetyCarDelta },
  };
}

function telemetryPrompt(summary: any, sampleRows: any[]) {
  const head =
    "You are Pitwall, a telemetry analyst. Be concise, bullet the key issues, suggest 2-3 actions. Admit uncertainty.\n";
  const summaryText = JSON.stringify(summary, null, 2);
  const sample = JSON.stringify(sampleRows.slice(0, 5), null, 2);
  return `${head}
Telemetry summary (stats/trends/outliers):
${summaryText}

First 5 rows sample:
${sample}

Please:
- Call out suspicious signals (overheating, voltage sag, pressure drops, RPM/speed oscillations).
- Mention if trends suggest risk in next stint.
- Propose 2-3 prioritized actions or checks.`;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // -------- Chat pass-through to DO --------
    if (url.pathname === "/api/chat" && request.method === "POST") {
      const { sessionId, message } = await request.json<any>();
      if (!sessionId || typeof message !== "string" || !message.trim()) {
        return new Response(JSON.stringify({ error: "Missing sessionId or message" }), { status: 400 });
      }
      const id = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(id);
      return await stub.fetch("http://do/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
    }

    if (url.pathname === "/api/history" && request.method === "POST") {
      const { sessionId } = await request.json<any>();
      if (!sessionId) return new Response("Missing sessionId", { status: 400 });
      const id = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(id);
      return await stub.fetch("http://do/history");
    }

    // -------- Telemetry analyze (and save into session context) --------
    if (url.pathname === "/api/telemetry/analyze" && request.method === "POST") {
      const body = await request.json<any>();
      const csv: string = (body?.csv ?? "").toString();
      const sessionId: string | undefined = body?.sessionId;
      if (!csv.trim()) {
        return new Response(JSON.stringify({ error: "Missing csv" }), { status: 400 });
      }

      const parsed = parseCSV(csv);
      const stats = statsFor(parsed.rows, parsed.headers);
      const summary = { headers: parsed.headers, stats, rowCount: parsed.rows.length };

      const messages = [
        { role: "system", content: "You are a telemetry analyst for a race team. Be concise, use bullet points, and suggest 2-3 actions." },
        { role: "user", content: telemetryPrompt(summary, parsed.rows) },
      ];
      const res: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, { messages } as any);
      const analysis: string = res?.response ?? res?.output_text ?? "No analysis.";

      // Store into the session DO as context if sessionId provided
      if (sessionId) {
        try {
          const id = env.SESSION_DO.idFromName(sessionId);
          const stub = env.SESSION_DO.get(id);

          // a small, human-friendly “notable” line to help future chat
          const notable =
            Object.entries(stats)
              .slice(0, 5)
              .map(([k, v]: any) => {
                const t = typeof v?.trend === "number" ? v.trend.toFixed(2) : "0";
                const oc = v?.outlierCount ?? 0;
                return `${k}: trend=${t}, outliers=${oc}`;
              })
              .join("; ")
              .slice(0, 240) || null;

          await stub.fetch("http://do/context", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              telemetry: {
                rowCount: summary.rowCount,
                headers: summary.headers,
                notable,
                analysisText: analysis,
              },
            }),
          });
        } catch {}
      }

      return new Response(JSON.stringify({ summary, analysis }), { headers: { "content-type": "application/json" } });
    }

    // -------- Strategy sim (and save into session context) --------
    if (url.pathname === "/api/strategy/sim" && request.method === "POST") {
      const input = await request.json<any>();
      const sessionId: string | undefined = input?.sessionId;
      const result = simulateStrategy(input);

      const commentaryMessages = [
        { role: "system", content: "You are a race strategist. Be concise, quantify risks, and give a recommendation." },
        { role: "user", content: `Given this simulation result, provide a 3-bullet recommendation and any watchouts:\n${JSON.stringify(result, null, 2)}` },
      ];
      const res: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, { messages: commentaryMessages } as any);
      const commentary: string = res?.response ?? res?.output_text ?? "";

      // Store into the session DO as context if sessionId provided
      if (sessionId) {
        try {
          const id = env.SESSION_DO.idFromName(sessionId);
          const stub = env.SESSION_DO.get(id);
          await stub.fetch("http://do/context", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              strategy: {
                params: {
                  baseLapTime: input?.baseLapTime,
                  tireDegradationPerLap: input?.tireDegradationPerLap,
                  fuelPerLap: input?.fuelPerLap,
                  tankSize: input?.tankSize,
                  pitLoss: input?.pitLoss,
                  stintPlan: input?.stintPlan,
                },
                result,
                commentary,
              },
            }),
          });
        } catch {}
      }

      return new Response(JSON.stringify({ result, commentary }), { headers: { "content-type": "application/json" } });
    }

    return new Response("Not Found", { status: 404 });
  },
};
