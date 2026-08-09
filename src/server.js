import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import { errorResult, toolResult } from "./result.js";
import { getDocumentLinks, getNotice, inspectGermanExport, listSources, searchNotices } from "./service.js";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function registerTools(server) {
  server.registerTool("list_sources", {
    description: "List supported neutral public-procurement sources, coverage and access constraints.",
    inputSchema: {},
  }, async () => toolResult(listSources()));

  server.registerTool("search_notices", {
    description: "Search and normalize public procurement notices. Company-specific relevance rules must be supplied by the calling agent or skill.",
    inputSchema: {
      source: z.enum(["ted", "doe", "all"]).default("ted"),
      expert_query: z.string().optional().describe("Raw TED expert query. Used only for TED and preferred for advanced searches."),
      keywords: z.array(z.string()).max(25).default([]),
      published_from: dateString.optional(),
      published_to: dateString.optional(),
      countries: z.array(z.string().length(3)).max(30).default([]).describe("Three-letter TED/eForms country codes, for example DEU."),
      cpv_codes: z.array(z.string()).max(100).default([]),
      page: z.number().int().min(1).default(1),
      page_size: z.number().int().min(1).max(100).default(20),
      fields: z.array(z.string()).max(100).optional().describe("Optional TED result fields."),
    },
  }, async (input) => {
    try { return toolResult(await searchNotices(input)); }
    catch (error) { return errorResult(error, { source: input.source }); }
  });

  server.registerTool("get_notice", {
    description: "Retrieve one normalized notice by its source-specific identifier.",
    inputSchema: {
      source: z.enum(["ted", "doe"]),
      source_notice_id: z.string().min(1),
      publication_date: dateString.optional().describe("Required for DÖE because it publishes daily exports."),
    },
  }, async (input) => {
    if (input.source === "doe" && !input.publication_date) return errorResult("publication_date is required for DÖE");
    try { return toolResult(await getNotice(input)); }
    catch (error) { return errorResult(error, { source: input.source, source_notice_id: input.source_notice_id }); }
  });

  server.registerTool("get_document_links", {
    description: "Return document and source links from a notice without downloading their content.",
    inputSchema: {
      source: z.enum(["ted", "doe"]),
      source_notice_id: z.string().min(1),
      publication_date: dateString.optional(),
    },
  }, async (input) => {
    if (input.source === "doe" && !input.publication_date) return errorResult("publication_date is required for DÖE");
    try { return toolResult(await getDocumentLinks(input)); }
    catch (error) { return errorResult(error, { source: input.source, source_notice_id: input.source_notice_id }); }
  });

  server.registerTool("inspect_german_export", {
    description: "Download and inspect one daily DÖE CSV ZIP export, returning its table counts and normalized notices.",
    inputSchema: {
      publication_date: dateString,
      page: z.number().int().min(1).default(1),
      page_size: z.number().int().min(1).max(100).default(20),
    },
  }, async (input) => {
    try { return toolResult(await inspectGermanExport(input)); }
    catch (error) { return errorResult(error, { source: "doe", publication_date: input.publication_date }); }
  });
}

export function createMcpServer() {
  const server = new McpServer({ name: "public-procurement-mcp", version: "1.0.0" });
  registerTools(server);
  return server;
}

function authorized(req) {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

export function createHttpApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.get("/status", (_req, res) => res.json({ status: "ok", service: "public-procurement-mcp", version: "1.0.0" }));
  app.use("/mcp", (req, res, next) => {
    if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
    next();
  });
  app.post("/mcp", async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });
  app.get("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
  return app;
}
