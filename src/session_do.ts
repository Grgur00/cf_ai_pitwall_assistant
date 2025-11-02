export class SessionDO {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // Tune these
  private static readonly MODEL_ID: keyof AiModels = "@cf/meta/llama-3-8b-instruct";
  private static readonly MAX_TURNS = 12; // keep convo short
  private static readonly STORAGE_KEY = "log";

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/chat") && request.method === "POST") {
      const { message } = await request.json<any>();
      if (!message || typeof message !== "string") {
        return new Response(JSON.stringify({ error: "Bad message" }), { status: 400 });
      }

      // Load history
      const log: any[] = (await this.state.storage.get(SessionDO.STORAGE_KEY)) || [];

      // Build messages with system prompt
      const system = {
        role: "system",
        content:
          "You are Pitwall, a concise, helpful technical assistant. Use short bullet points when advising. Admit uncertainty. Keep replies under ~200 words unless asked."
      };

      const messages = [system, ...log].slice(-2 * SessionDO.MAX_TURNS);
      messages.push({ role: "user", content: message });

      // Call Workers AI
      const result: any = await this.env.AI.run(SessionDO.MODEL_ID, { messages });

      const reply = typeof result.response === "string"
        ? result.response
        : (result.output_text ?? JSON.stringify(result));

      // Update memory
      const newLog = [...log, { role: "user", content: message }, { role: "assistant", content: reply }].slice(-2 * SessionDO.MAX_TURNS);
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

export interface Env {
  AI: Ai;
  CHAT_KV: KVNamespace;
  SESSION_DO: DurableObjectNamespace; 
}
