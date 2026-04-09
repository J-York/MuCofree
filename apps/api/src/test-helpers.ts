import request from "supertest";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

export function createCsrfAgent(app: Parameters<typeof request.agent>[0]) {
  const agent = request.agent(app);
  let csrfToken: string | null = null;

  agent.use((req) => {
    const method = (req.method ?? "GET").toUpperCase();
    if (SAFE_METHODS.has(method)) return;
    if (csrfToken) {
      req.set("x-csrf-token", csrfToken);
    }
  });

  return {
    agent,
    setCsrfToken(token: string | null) {
      csrfToken = token;
    },
    get csrfToken() {
      return csrfToken;
    }
  };
}
