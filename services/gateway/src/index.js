import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { logEvent } from "@miniraft/shared/src/logger.js";

const PORT = Number(process.env.PORT || 8080);
const REPLICAS = (process.env.REPLICAS || "localhost:5001,localhost:5002,localhost:5003")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const app = express();
app.use(express.json({ limit: "1mb" }));

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

async function sendStrokeToLeader(stroke, attempt = 0) {
  const leader = await findLeader();
  if (!leader) {
    return { ok: false, reason: "leader_not_found" };
  }

  const result = await fetchJson(`http://${leader}/client/stroke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stroke }),
  });

  if (result.ok) {
    return result.body;
  }

  if (result.status === 409 && attempt < 3) {
    knownLeader = null;
    return sendStrokeToLeader(stroke, attempt + 1);
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
  res.json({
    ok: true,
    leader,
    replicas: REPLICAS,
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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

wss.on("connection", async (ws) => {
  const existing = await getCommittedEntries();
  ws.send(JSON.stringify({ type: "snapshot", entries: existing }));

  ws.on("message", async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      if (message.type !== "stroke") {
        return;
      }

      const result = await sendStrokeToLeader(message.stroke);
      if (result.ok && result.entry?.committed) {
        broadcast({ type: "stroke", entry: result.entry });
        logEvent({
          service: "gateway",
          eventType: "stroke_broadcast",
          index: result.entry.index,
          term: result.entry.term,
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
