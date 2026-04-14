const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const clusterSummaryEl = document.getElementById("clusterSummary");
const replicaListEl = document.getElementById("replicaList");

let drawing = false;
let lastPoint = null;

function drawStroke(stroke) {
  ctx.strokeStyle = stroke.color || "#111827";
  ctx.lineWidth = stroke.width || 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(stroke.from.x, stroke.from.y);
  ctx.lineTo(stroke.to.x, stroke.to.y);
  ctx.stroke();
}

function wsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const gatewayPort = window.GATEWAY_PORT || "8080";
  return `${protocol}://${host}:${gatewayPort}`;
}

const socket = new WebSocket(wsUrl());

socket.addEventListener("open", () => {
  statusEl.textContent = "Connected";
});

socket.addEventListener("close", () => {
  statusEl.textContent = "Disconnected";
});

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  if (payload.type === "snapshot") {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const entry of payload.entries || []) {
      drawStroke(entry.stroke);
    }
  }
  if (payload.type === "cluster") {
    const leader = payload.leader;
    const leaderNodeId = payload.leaderNodeId;
    const term = payload.term;
    const replicas = Array.isArray(payload.replicas) ? payload.replicas : [];

    const leaderLabel = leaderNodeId ? `${leaderNodeId} (${leader || "unknown"})` : leader || "unknown";
    clusterSummaryEl.textContent = `Leader: ${leaderLabel} · term: ${term ?? "?"}`;

    replicaListEl.innerHTML = "";
    for (const r of replicas) {
      const li = document.createElement("li");
      li.textContent = `${r.nodeId || "?"} @ ${r.address || "?"} — ${r.state || "?"} (term ${r.currentTerm ?? "?"}, commit ${r.commitIndex ?? "?"}, log ${r.logLength ?? "?"})`;
      replicaListEl.appendChild(li);
    }
  }
  if (payload.type === "stroke" && payload.entry?.stroke) {
    drawStroke(payload.entry.stroke);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  drawing = true;
  lastPoint = { x: event.offsetX, y: event.offsetY };
});

canvas.addEventListener("pointermove", (event) => {
  if (!drawing || !lastPoint) return;
  const nextPoint = { x: event.offsetX, y: event.offsetY };
  const stroke = {
    from: lastPoint,
    to: nextPoint,
    color: "#0f172a",
    width: 3,
  };
  drawStroke(stroke);
  socket.send(JSON.stringify({ type: "stroke", stroke }));
  lastPoint = nextPoint;
});

window.addEventListener("pointerup", () => {
  drawing = false;
  lastPoint = null;
});
