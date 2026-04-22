const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("statusBadge");
const clusterSummaryEl = document.getElementById("clusterSummary");
const replicaCardsEl = document.getElementById("replicaCards");
const colorPicker = document.getElementById("colorPicker");
const sizeSlider = document.getElementById("sizeSlider");
const sizeValue = document.getElementById("sizeValue");
const clearLocalBtn = document.getElementById("clearLocalBtn");

let drawing = false;
let lastPoint = null;
let brushColor = colorPicker.value;
let brushWidth = Number(sizeSlider.value);

function drawStroke(stroke) {
  ctx.strokeStyle = stroke.color || "#111827";
  ctx.lineWidth = stroke.width || 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(stroke.from.x, stroke.from.y);
  ctx.lineTo(stroke.to.x, stroke.to.y);
  ctx.stroke();
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.classList.remove("connected", "connecting", "disconnected");
  statusEl.classList.add(cls);
}

function getBoardPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  return { x, y };
}

function formatStateClass(state) {
  const value = (state || "").toLowerCase();
  if (value.includes("leader")) return "state-leader";
  if (value.includes("candidate")) return "state-candidate";
  if (value.includes("unreachable")) return "state-unreachable";
  return "state-follower";
}

function renderReplicaCards(replicas) {
  replicaCardsEl.innerHTML = "";

  for (const replica of replicas) {
    const card = document.createElement("article");
    card.className = "replica-card";

    const title = document.createElement("h3");
    title.textContent = `${replica.nodeId || "unknown node"} @ ${replica.address || "?"}`;

    const meta = document.createElement("ul");
    meta.className = "replica-meta";

    const stateItem = document.createElement("li");
    stateItem.className = formatStateClass(replica.state);
    stateItem.textContent = `state=${replica.state || "?"}`;

    const termItem = document.createElement("li");
    termItem.textContent = `term=${replica.currentTerm ?? "?"}`;

    const commitItem = document.createElement("li");
    commitItem.textContent = `commit=${replica.commitIndex ?? "?"}`;

    const logItem = document.createElement("li");
    logItem.textContent = `logLength=${replica.logLength ?? "?"}`;

    meta.append(stateItem, termItem, commitItem, logItem);
    card.append(title, meta);
    replicaCardsEl.appendChild(card);
  }
}

function wsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const gatewayPort = window.GATEWAY_PORT || "8080";
  return `${protocol}://${host}:${gatewayPort}`;
}

const socket = new WebSocket(wsUrl());

socket.addEventListener("open", () => {
  setStatus("Connected", "connected");
});

socket.addEventListener("close", () => {
  setStatus("Disconnected - retry by refreshing if needed", "disconnected");
});

socket.addEventListener("error", () => {
  setStatus("Connection Error", "disconnected");
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
    renderReplicaCards(replicas);
  }
  if (payload.type === "stroke" && payload.entry?.stroke) {
    drawStroke(payload.entry.stroke);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  lastPoint = getBoardPoint(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (!drawing || !lastPoint) return;
  const nextPoint = getBoardPoint(event);
  const stroke = {
    from: lastPoint,
    to: nextPoint,
    color: brushColor,
    width: brushWidth,
  };
  drawStroke(stroke);
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "stroke", stroke }));
  }
  lastPoint = nextPoint;
});

window.addEventListener("pointerup", () => {
  drawing = false;
  lastPoint = null;
});

sizeSlider.addEventListener("input", () => {
  brushWidth = Number(sizeSlider.value);
  sizeValue.textContent = `${brushWidth} px`;
});

colorPicker.addEventListener("input", () => {
  brushColor = colorPicker.value;
});

clearLocalBtn.addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

setStatus("Connecting...", "connecting");
