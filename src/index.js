import { createHttpApp } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
createHttpApp().listen(port, "0.0.0.0", () => {
  console.log(`public-procurement-mcp listening on port ${port}`);
});
