// contour-engine entrypoint. One Node.js service, two Interfaces over one core:
//   - Contour MCP Server — streamable HTTP at /mcp   (serves the AI Agent)
//   - Meanings UI        — the built-in browser Console: a form-based, three-pane
//                          Modeler editor served as the static SPA, with its Web
//                          UI binding transport under /bff   (serves the Modeler)
// /bff is the Console binding's transport (an implementation detail of the
// Console): it calls the one core (core/service) in-process — the same Functions
// the MCP Server exposes — so the Console reimplements no storage, search,
// validation or rendering of its own.
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./mcp.js";
import { registerBffApi } from "./bffApi.js";
import { migrate } from "./migrate.js";

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  if (process.env.CONTOUR_AUTO_MIGRATE !== "0") await migrate();

  const app = Fastify({ logger: true });

  // For /mcp, capture the raw JSON string and hand it to the transport as the
  // pre-parsed body; for everything else, parse JSON normally.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (req.url === "/mcp") {
      try { (req as unknown as { mcpBody: unknown }).mcpBody = body ? JSON.parse(body as string) : undefined; }
      catch { (req as unknown as { mcpBody: unknown }).mcpBody = undefined; }
      done(null, undefined);
    } else {
      try { done(null, body ? JSON.parse(body as string) : undefined); }
      catch (e) { done(e as Error, undefined); }
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  // --- Contour MCP Server (streamable HTTP, stateless: new server+transport per request) ---
  app.all("/mcp", async (request, reply) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const parsedBody = (request as unknown as { mcpBody: unknown }).mcpBody;
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, parsedBody);
    } finally {
      reply.raw.on("close", () => { transport.close(); server.close(); });
    }
  });

  // --- Built-in Console: the Meanings UI's Web UI binding transport (in-process core) ---
  await registerBffApi(app);

  // --- Static SPA (the Console UI, built by Vite into dist/ui) ---
  const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");
  app.register(fastifyStatic, { root: uiDir, prefix: "/" });
  app.setNotFoundHandler((req, reply) => {
    // SPA fallback for client-side routes (not for API paths).
    if (req.url.startsWith("/mcp") || req.url.startsWith("/bff")) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.sendFile("index.html");
  });

  await app.listen({ port: PORT, host: HOST });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
