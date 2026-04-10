import express from "express";
import { RpcPaths } from "@miniraft/shared/src/contracts.js";
import { RaftNode } from "./raftNode.js";

const PORT = Number(process.env.PORT || 5000);
const NODE_ID = process.env.NODE_ID || `replica-${PORT}`;
const PEERS = (process.env.PEERS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const DATA_DIR = process.env.DATA_DIR || "./data";
const ADVERTISE_ADDR = process.env.ADVERTISE_ADDR || `localhost:${PORT}`;

const app = express();
app.use(express.json({ limit: "1mb" }));

const node = new RaftNode({
  nodeId: NODE_ID,
  peers: PEERS,
  dataDir: DATA_DIR,
  advertiseAddress: ADVERTISE_ADDR,
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get(RpcPaths.STATUS, (_req, res) => {
  res.json(node.status());
});

app.post(RpcPaths.REQUEST_VOTE, (req, res) => {
  res.json(node.handleRequestVote(req.body));
});

app.post(RpcPaths.HEARTBEAT, (req, res) => {
  res.json(node.handleAppendEntries(req.body));
});

app.post(RpcPaths.APPEND_ENTRIES, (req, res) => {
  res.json(node.handleAppendEntries(req.body));
});

app.post(RpcPaths.SYNC_LOG, (req, res) => {
  res.json(node.handleSyncLog(req.body));
});

app.post("/client/stroke", async (req, res) => {
  const { stroke } = req.body || {};
  if (!stroke) {
    return res.status(400).json({ ok: false, error: "stroke is required" });
  }

  const result = await node.appendClientStroke(stroke);
  if (!result.ok && result.reason === "not_leader") {
    return res.status(409).json(result);
  }

  if (!result.ok) {
    return res.status(503).json(result);
  }

  return res.json({ ok: true, entry: result.entry });
});

app.get("/client/committed-log", (_req, res) => {
  const status = node.status();
  return res.json({
    ok: true,
    nodeId: status.nodeId,
    commitIndex: status.commitIndex,
    entries: node.log.filter((entry) => entry.committed),
  });
});

app.listen(PORT, () => {
  console.log(`Replica ${NODE_ID} listening on ${PORT}`);
});
