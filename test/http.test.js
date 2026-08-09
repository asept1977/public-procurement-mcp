import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpApp } from "../src/server.js";

async function withServer(run) {
  const server = createHttpApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("status is public and MCP endpoint enforces bearer auth", async () => {
  const original = process.env.MCP_AUTH_TOKEN;
  process.env.MCP_AUTH_TOKEN = "test-secret";
  try {
    await withServer(async (base) => {
      const status = await fetch(`${base}/status`);
      assert.equal(status.status, 200);
      assert.equal((await status.json()).status, "ok");
      const unauthorized = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(unauthorized.status, 401);
    });
  } finally {
    if (original == null) delete process.env.MCP_AUTH_TOKEN;
    else process.env.MCP_AUTH_TOKEN = original;
  }
});

test("supports a stateless MCP handshake and neutral tool call", async () => {
  const originalToken = process.env.MCP_AUTH_TOKEN;
  process.env.MCP_AUTH_TOKEN = "test-secret";
  await withServer(async (base) => {
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: "Bearer test-secret" } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "search_notices"));
    const result = await client.callTool({ name: "list_sources", arguments: {} });
    assert.equal(result.structuredContent.neutral, true);
    await client.close();
  });
  if (originalToken == null) delete process.env.MCP_AUTH_TOKEN;
  else process.env.MCP_AUTH_TOKEN = originalToken;
});
