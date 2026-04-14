import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

const server = app.listen(PORT, () => {
  console.log(`Frontend listening on ${PORT}`);
});

function shutdown(signal) {
  console.log(`Frontend shutting down (${signal})`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
