/// <reference types="@cloudflare/workers-types" />

/** ---- Durable Object (must be a named export in the entrypoint) ---- */
export class SessionDO {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private static readonly MODEL_ID = "@cf/meta/llama-3.1-8b-instruct" as any;
  private static readonly MAX_TURNS = 12;
  private static readonly STORAGE_KEY = "log";

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/chat") && request.method === "POST") {
      const { message } = await request.json<any>();
      const text = (message ?? "").toString().trim();
      if (!text) return new Response(JSON.stringify({ error: "Bad message" }), { status: 400 });

      const log: any[] = (await this.state.storage.get(SessionDO.STORAGE_KEY)) || [];

      const system = {
        role: "system",
        content:
          "You are Pitwall, a concise, helpful technical assistant. Use short bullet points when advising. Admit uncertainty. Keep replies under ~200 words unless asked."
      };

      const messages = [system, ...log].slice(-2 * SessionDO.MAX_TURNS);
      messages.push({ role: "user", content: text });

      const result: any = await this.env.AI.run(SessionDO.MODEL_ID, { messages } as any);
      const reply = typeof result.response === "string"
        ? result.response
        : (result.output_text ?? JSON.stringify(result));

      const newLog = [...log, { role: "user", content: text }, { role: "assistant", content: reply }]
        .slice(-2 * SessionDO.MAX_TURNS);

      await this.state.storage.put(SessionDO.STORAGE_KEY, newLog);

      return new Response(JSON.stringify({ reply }), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname.endsWith("/history")) {
      const log: any[] = (await this.state.storage.get(SessionDO.STORAGE_KEY)) || [];
      return new Response(JSON.stringify({ history: log }), { headers: { "content-type": "application/json" } });
    }

    return new Response("Not Found", { status: 404 });
  }
}

/** ---- Env bindings (keep namespace non-generic to avoid branded type error) ---- */
export interface Env {
  AI: Ai;
  CHAT_KV: KVNamespace;
  SESSION_DO: DurableObjectNamespace;
}

/** ---- Worker fetch (default export) ---- */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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
        body: JSON.stringify({ message })
      });
    }

    if (url.pathname === "/api/history" && request.method === "POST") {
      const { sessionId } = await request.json<any>();
      if (!sessionId) return new Response("Missing sessionId", { status: 400 });
      const id = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(id);
      return await stub.fetch("http://do/history");
    }

    return new Response("Not Found", { status: 404 });
  }
};
