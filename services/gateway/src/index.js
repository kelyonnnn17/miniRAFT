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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    if (attempt < 5) {
      await delay(150);
      return sendStrokeToLeader(stroke, attempt + 1);
    }
    return { ok: false, reason: "leader_not_found" };
  }

  let result;
  try {
    result = await fetchJson(`http://${leader}/client/stroke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stroke }),
    });
  } catch {
    knownLeader = null;
    if (attempt < 5) {
      await delay(150);
      return sendStrokeToLeader(stroke, attempt + 1);
    }
    return { ok: false, reason: "leader_unreachable" };
  }

  if (result.ok) {
    return result.body;
  }

  if ((result.status === 409 || result.status === 503) && attempt < 5) {
    knownLeader = null;
    await delay(150);
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

async function getClusterStatus() {
  const leader = await findLeader();
  const statuses = await Promise.all(
    REPLICAS.map(async (address) => {
      try {
        const result = await fetchJson(`http://${address}/status`);
        if (!result.ok) {
          return { address, ok: false };
        }
        return { address, ok: true, ...result.body };
      } catch {
        return { address, ok: false };
      }
    }),
  );

  const leaderStatus = statuses.find((s) => s.ok && s.state === "Leader");
  return {
    leader: leader,
    leaderNodeId: leaderStatus?.nodeId || null,
    term: leaderStatus?.currentTerm ?? null,
    replicas: statuses.map((s) => ({
      address: s.address,
      nodeId: s.ok ? s.nodeId : null,
      state: s.ok ? s.state : "Unreachable",
      currentTerm: s.ok ? s.currentTerm : null,
      commitIndex: s.ok ? s.commitIndex : null,
      logLength: s.ok ? s.logLength : null,
      leaderId: s.ok ? s.leaderId : null,
    })),
  };
}

async function triggerLeaderElectionIfPossible() {
  const cluster = await getClusterStatus();
  const alive = (cluster.replicas || []).filter((replica) => replica.state !== "Unreachable");

  if (alive.length <= 1) {
    return { ok: true, triggered: false, reason: "single_node_remaining" };
  }

  const leaderAddr = cluster.leader || alive.find((replica) => replica.state === "Leader")?.address;
  if (!leaderAddr) {
    return { ok: false, triggered: false, reason: "leader_not_found" };
  }

  try {
    const result = await fetchJson(`http://${leaderAddr}/admin/step-down`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "user_disconnect" }),
    });

    if (!result.ok) {
      return { ok: false, triggered: false, reason: "step_down_failed" };
    }

    logEvent({
      service: "gateway",
      eventType: "leader_step_down_requested",
      leader: leaderAddr,
    });
    return { ok: true, triggered: true, leader: leaderAddr };
  } catch {
    return { ok: false, triggered: false, reason: "leader_unreachable" };
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

function sanitizeName(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 24);
}

function currentUsers() {
  const users = [];
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.clientName) {
      users.push(client.clientName);
    }
  }
  return [...new Set(users)];
}

function broadcastUsers() {
  broadcast({ type: "users", users: currentUsers() });
}

wss.on("connection", async (ws, req) => {
  let initialName = null;
  try {
    const parsed = new URL(req.url || "/", "http://gateway.local");
    initialName = sanitizeName(parsed.searchParams.get("name"));
  } catch {
    initialName = null;
  }

  ws.clientName = initialName;

  const existing = await getCommittedEntries();
  ws.send(JSON.stringify({ type: "snapshot", entries: existing }));
  ws.send(JSON.stringify({ type: "users", users: currentUsers() }));
  if (ws.clientName) {
    ws.send(JSON.stringify({ type: "welcome", name: ws.clientName }));
  }
  broadcastUsers();

  let stopped = false;
  const sendCluster = async () => {
    if (stopped || ws.readyState !== 1) return;
    const cluster = await getClusterStatus();
    if (stopped || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "cluster", ...cluster }));
  };

  // Initial cluster state + periodic refresh (helps explain RAFT to users and aids debugging).
  sendCluster().catch(() => {});
  const clusterTimer = setInterval(() => {
    sendCluster().catch(() => {});
  }, 2000);

  ws.on("message", async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      if (message.type === "introduce") {
        const name = sanitizeName(message.name);
        if (!name) {
          ws.send(JSON.stringify({ type: "error", message: "name is required" }));
          return;
        }

        ws.clientName = name;
        ws.send(JSON.stringify({ type: "welcome", name }));
        broadcastUsers();
        return;
      }

      if (message.type === "disconnect") {
        await triggerLeaderElectionIfPossible();
        ws.close();
        return;
      }

      if (message.type !== "stroke") {
        return;
      }

      const stroke = {
        ...(message.stroke || {}),
        user: ws.clientName || sanitizeName(message.stroke?.user) || "Guest",
      };

      const result = await sendStrokeToLeader(stroke);
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

  ws.on("close", () => {
    stopped = true;
    clearInterval(clusterTimer);
    broadcastUsers();
  });

  ws.on("error", () => {
    stopped = true;
    clearInterval(clusterTimer);
    broadcastUsers();
  });
});

server.listen(PORT, () => {
  console.log(`Gateway listening on ${PORT}`);
});

function shutdown(signal) {
  console.log(`Gateway shutting down (${signal})`);
  try {
    wss.close();
  } catch {
    // ignore
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
