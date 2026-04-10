import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";

const ROOT = process.cwd();

function spawnService(entryFile, env) {
  const child = spawn(process.execPath, [entryFile], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
    },
    stdio: "ignore",
  });

  return child;
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function issueToken(gatewayPort, userId, boardId = "default") {
  const result = await fetchJson(`http://127.0.0.1:${gatewayPort}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, boardId, role: "editor" }),
  });
  assert.equal(result.ok, true);
  return result.body.token;
}

async function getStatus(address) {
  try {
    const result = await fetchJson(`http://${address}/status`);
    return result.ok ? result.body : null;
  } catch {
    return null;
  }
}

async function getLeaderAddress(replicaAddresses) {
  const statuses = await Promise.all(replicaAddresses.map((address) => getStatus(address)));
  const leaders = statuses
    .map((status, index) => ({ status, address: replicaAddresses[index] }))
    .filter((x) => x.status?.state === "Leader");

  return leaders.length === 1 ? leaders[0].address : null;
}

async function sendStrokeToReplica(address, stroke) {
  return fetchJson(`http://${address}/client/stroke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stroke }),
  });
}

async function getCommittedEntries(address) {
  const result = await fetchJson(`http://${address}/client/committed-log`);
  assert.equal(result.ok, true);
  return result.body.entries;
}

async function tryGetCommittedEntries(address) {
  try {
    return await getCommittedEntries(address);
  } catch {
    return null;
  }
}

function terminate(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }

    const done = () => resolve();
    child.once("exit", done);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 1200);
  });
}

async function startReplica({ port, id, peers, dataDir }) {
  await fs.mkdir(dataDir, { recursive: true });
  return spawnService("services/replica/src/index.js", {
    PORT: String(port),
    NODE_ID: id,
    ADVERTISE_ADDR: `127.0.0.1:${port}`,
    PEERS: peers.join(","),
    DATA_DIR: dataDir,
    ELECTION_MIN_MS: "250",
    ELECTION_MAX_MS: "450",
    HEARTBEAT_MS: "100",
  });
}

function waitForWebSocketMessage(ws, matcher, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);

    const onMessage = (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (matcher(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };

    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

test("cluster failover + catch-up + gateway flow", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "miniraft-it-"));

  const replicaConfig = [
    { port: 6101, id: "replica-1" },
    { port: 6102, id: "replica-2" },
    { port: 6103, id: "replica-3" },
  ];
  const addresses = replicaConfig.map((x) => `127.0.0.1:${x.port}`);

  const procById = new Map();
  for (const replica of replicaConfig) {
    const peers = addresses.filter((addr) => addr !== `127.0.0.1:${replica.port}`);
    const dataDir = path.join(tempRoot, replica.id);
    const proc = await startReplica({
      port: replica.port,
      id: replica.id,
      peers,
      dataDir,
    });
    procById.set(replica.id, { proc, peers, dataDir, port: replica.port });
    t.after(async () => terminate(proc));
  }

  const gatewayPort = 6180;
  const gateway = spawnService("services/gateway/src/index.js", {
    PORT: String(gatewayPort),
    REPLICAS: addresses.join(","),
  });
  t.after(async () => terminate(gateway));

  const leaderAddress = await waitFor(
    () => getLeaderAddress(addresses),
    10000,
    "initial leader election",
  );

  for (let i = 0; i < 4; i += 1) {
    const result = await sendStrokeToReplica(leaderAddress, {
      from: { x: i * 10, y: i * 10 },
      to: { x: i * 10 + 5, y: i * 10 + 5 },
      color: "#0f172a",
      width: 3,
    });
    assert.equal(result.ok, true, `initial stroke ${i} should commit`);
  }

  const followerToReset = replicaConfig.find((x) => `127.0.0.1:${x.port}` !== leaderAddress);
  assert.ok(followerToReset, "follower to restart must exist");

  const followerState = procById.get(followerToReset.id);
  await terminate(followerState.proc);
  await fs.rm(followerState.dataDir, { recursive: true, force: true });

  for (let i = 4; i < 7; i += 1) {
    const result = await sendStrokeToReplica(leaderAddress, {
      from: { x: i * 11, y: i * 11 },
      to: { x: i * 11 + 5, y: i * 11 + 5 },
      color: "#2563eb",
      width: 3,
    });
    assert.equal(result.ok, true, `post-follower-down stroke ${i} should commit`);
  }

  const restartedFollower = await startReplica({
    port: followerState.port,
    id: followerToReset.id,
    peers: followerState.peers,
    dataDir: followerState.dataDir,
  });
  procById.set(followerToReset.id, {
    ...followerState,
    proc: restartedFollower,
  });
  t.after(async () => terminate(restartedFollower));

  const leaderEntriesAfterRestart = await waitFor(
    () => tryGetCommittedEntries(leaderAddress),
    8000,
    "leader entries after follower restart",
  );

  await waitFor(async () => {
    const followerEntries = await tryGetCommittedEntries(`127.0.0.1:${followerState.port}`);
    if (!followerEntries) {
      return false;
    }
    return followerEntries.length === leaderEntriesAfterRestart.length;
  }, 12000, "follower catch-up via sync-log");

  const leaderId = replicaConfig.find((x) => `127.0.0.1:${x.port}` === leaderAddress)?.id;
  const leaderProcState = procById.get(leaderId);
  await terminate(leaderProcState.proc);

  const newLeaderAddress = await waitFor(async () => {
    const candidate = await getLeaderAddress(addresses);
    return candidate && candidate !== leaderAddress ? candidate : null;
  }, 12000, "leader failover");

  const token = await issueToken(gatewayPort, "integration-user");
  const authedWs = new WebSocket(`ws://127.0.0.1:${gatewayPort}/?token=${encodeURIComponent(token)}`);
  t.after(() => authedWs.close());

  await waitFor(
    () => new Promise((resolve) => resolve(authedWs.readyState === 1 ? true : false)),
    6000,
    "gateway websocket connection",
  );

  authedWs.send(
    JSON.stringify({
      type: "stroke",
      stroke: {
        from: { x: 300, y: 310 },
        to: { x: 350, y: 370 },
        color: "#dc2626",
        width: 4,
      },
    }),
  );

  const broadcast = await waitForWebSocketMessage(
    authedWs,
    (msg) => msg.type === "stroke" && msg.entry?.committed === true,
    12000,
  );
  assert.equal(broadcast.type, "stroke");

  const restartedOldLeader = await startReplica({
    port: leaderProcState.port,
    id: leaderId,
    peers: leaderProcState.peers,
    dataDir: leaderProcState.dataDir,
  });
  t.after(async () => terminate(restartedOldLeader));

  await waitFor(async () => {
    const baseEntries = await tryGetCommittedEntries(newLeaderAddress);
    if (!baseEntries) {
      return false;
    }
    const allLogs = await Promise.all(
      addresses.map(async (addr) => {
        const entries = await tryGetCommittedEntries(addr);
        if (!entries) {
          return null;
        }
        return JSON.stringify(entries);
      }),
    );
    if (allLogs.some((log) => log === null)) {
      return false;
    }
    return allLogs.every((log) => log === JSON.stringify(baseEntries));
  }, 15000, "all replicas converge after leader restart");
});
