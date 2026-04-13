import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { logEvent } from "@miniraft/shared/src/logger.js";
import { extractBearerToken, issueToken, verifyToken } from "@miniraft/shared/src/auth.js";
import { consumeRateLimit } from "@miniraft/shared/src/rateLimit.js";
import { normalizeAuthRequest, normalizeDrawingOperation } from "@miniraft/shared/src/validation.js";

const PORT = Number(process.env.PORT || 8080);
const REPLICAS = (process.env.REPLICAS || "localhost:5001,localhost:5002,localhost:5003")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  next();
});

app.options("*", (_req, res) => {
  res.sendStatus(204);
});

let knownLeader = null;
let nodeIdToAddress = {};

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

async function findLeader() {
  nodeIdToAddress = {};

  if (knownLeader) {
    try {
      const status = await fetchJson(`http://${knownLeader}/status`);
      if (status.ok && status.body.nodeId) {
        nodeIdToAddress[status.body.nodeId] = knownLeader;
      }
      if (status.ok && status.body.state === "Leader") {
        return knownLeader;
      }
    } catch {
      knownLeader = null;
    }
  }

  for (const replica of REPLICAS) {
    try {
      const status = await fetchJson(`http://${replica}/status`);
      if (status.ok && status.body.nodeId) {
        nodeIdToAddress[status.body.nodeId] = replica;
      }
      if (status.ok && status.body.state === "Leader") {
        knownLeader = replica;
        return replica;
      }
      if (status.ok && status.body.leaderId) {
        const leaderCandidate = nodeIdToAddress[status.body.leaderId];
        if (leaderCandidate) {
          knownLeader = leaderCandidate;
          return leaderCandidate;
        }
      }
    } catch {
      // ignore unreachable nodes while searching
    }
  }

  return null;
}

function getClientIdentityFromRequest(request) {
  const url = new URL(request.url, "http://localhost");
  const token = url.searchParams.get("token") || extractBearerToken(request.headers.authorization);
  const verified = verifyToken(token);
  if (!verified.valid) {
    return { ok: false, reason: verified.reason || "unauthorized" };
  }

  return { ok: true, payload: verified.payload };
}

async function sendOperationToLeader(operation, attempt = 0) {
  const leader = await findLeader();
  if (!leader) {
    return { ok: false, reason: "leader_not_found" };
  }

  const result = await fetchJson(`http://${leader}/client/stroke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation }),
  });

  if (result.ok) {
    return result.body;
  }

  if (result.status === 409 && attempt < 3) {
    knownLeader = null;
    return sendOperationToLeader(operation, attempt + 1);
  }

  return { ok: false, reason: result.body.reason || "append_failed" };
}

async function getCommittedEntries() {
  const leader = await findLeader();
  if (!leader) {
    return [];
  }

  try {
    const result = await fetchJson(`http://${leader}/client/committed-log`);
    if (!result.ok) {
      return [];
    }
    return result.body.entries || [];
  } catch {
    return [];
  }
}

app.get("/status", async (_req, res) => {
  const leader = await findLeader();
  res.json({ ok: true, leader, replicas: REPLICAS });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/token", (req, res) => {
  const normalized = normalizeAuthRequest(req.body);
  if (!normalized.ok) {
    return res.status(400).json({ ok: false, error: normalized.error });
  }

  const token = issueToken(normalized.value);
  return res.json({ ok: true, token, user: normalized.value });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(payload) {
  const encoded = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(encoded);
    }
  }
}

wss.on("connection", async (ws, request) => {
  const identityResult = getClientIdentityFromRequest(request);
  if (!identityResult.ok) {
    ws.send(JSON.stringify({ type: "error", message: "unauthorized" }));
    ws.close(1008, "unauthorized");
    return;
  }

  const identity = identityResult.payload;
  const existing = await getCommittedEntries();
  ws.send(JSON.stringify({ type: "snapshot", entries: existing, user: identity }));

  ws.on("message", async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      if (message.type !== "stroke" && message.type !== "clear") {
        return;
      }

      const rate = consumeRateLimit(identity.sub);
      if (!rate.allowed) {
        ws.send(JSON.stringify({ type: "error", message: "rate_limited" }));
        return;
      }

      const normalized = normalizeDrawingOperation(message.operation ?? message.stroke ?? message);
      if (!normalized.ok) {
        ws.send(JSON.stringify({ type: "error", message: normalized.error }));
        return;
      }

      const result = await sendOperationToLeader({
        ...normalized.value,
        userId: identity.sub,
        boardId: identity.boardId,
      });

      if (result.ok && result.entry?.committed) {
        broadcast({ type: "operation", entry: result.entry });
        logEvent({
          service: "gateway",
          eventType: "operation_broadcast",
          index: result.entry.index,
          term: result.entry.term,
          userId: identity.sub,
          boardId: identity.boardId,
        });
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "invalid message" }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Gateway listening on ${PORT}`);
});
