export function toolResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function errorResult(error, context = {}) {
  const data = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...context,
  };
  return {
    ...toolResult(data),
    isError: true,
  };
}
