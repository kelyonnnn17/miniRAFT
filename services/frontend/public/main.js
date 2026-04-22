const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("statusBadge");
const clusterSummaryEl = document.getElementById("clusterSummary");
const replicaCardsEl = document.getElementById("replicaCards");
const colorPicker = document.getElementById("colorPicker");
const sizeSlider = document.getElementById("sizeSlider");
const sizeValue = document.getElementById("sizeValue");
const clearLocalBtn = document.getElementById("clearLocalBtn");
const nameInput = document.getElementById("nameInput");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const selfNameEl = document.getElementById("selfName");
const userListEl = document.getElementById("userList");
const usersSummaryEl = document.getElementById("usersSummary");

let drawing = false;
let lastPoint = null;
let brushColor = colorPicker.value;
let brushWidth = Number(sizeSlider.value);
let socket = null;
let currentUserName = "";
let latestReplicas = [];
let latestUsers = [];
let latestTerm = null;

function buildUserNodeMap(replicas, users) {
  const safeReplicas = Array.isArray(replicas) ? replicas : [];
  const safeUsers = Array.isArray(users) ? users : [];
  const map = new Map();

  const count = Math.min(safeReplicas.length, safeUsers.length);
  for (let i = 0; i < count; i += 1) {
    map.set(safeReplicas[i].address, safeUsers[i]);
  }
  return map;
}

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

function normalizeUserName(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return "Guest";
  }
  return trimmed.slice(0, 24);
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

function renderReplicaCards(replicas, users) {
  const safeUsers = Array.isArray(users) ? users : [];
  const safeReplicas = Array.isArray(replicas) ? replicas : [];

  if (safeUsers.length === 0) {
    replicaCardsEl.innerHTML = "<p class=\"empty-note\">No active users yet. Connect with a name to assign labels to nodes.</p>";
    return;
  }

  const visibleCount = Math.min(safeUsers.length, safeReplicas.length);
  replicaCardsEl.innerHTML = "";

  for (let i = 0; i < visibleCount; i += 1) {
    const replica = safeReplicas[i];
    const userLabel = safeUsers[i];

    const card = document.createElement("article");
    card.className = "replica-card";

    const title = document.createElement("h3");
    title.textContent = `${userLabel} node`;

    const meta = document.createElement("ul");
    meta.className = "replica-meta";

    const stateItem = document.createElement("li");
    stateItem.className = formatStateClass(replica.state);
    stateItem.textContent = `role=${replica.state || "?"}`;

    const termItem = document.createElement("li");
    termItem.textContent = `term=${replica.currentTerm ?? "?"}`;

    const commitItem = document.createElement("li");
    commitItem.textContent = `commit=${replica.commitIndex ?? "?"}`;

    const logItem = document.createElement("li");
    logItem.textContent = `logLength=${replica.logLength ?? "?"}`;

    const addrItem = document.createElement("li");
    addrItem.textContent = `addr=${replica.address ?? "?"}`;

    meta.append(stateItem, termItem, commitItem, logItem, addrItem);
    card.append(title, meta);
    replicaCardsEl.appendChild(card);
  }
}

function updateClusterSummary(replicas, users, term) {
  const map = buildUserNodeMap(replicas, users);
  const leaderReplica = (Array.isArray(replicas) ? replicas : []).find((replica) => replica.state === "Leader");

  if (!leaderReplica) {
    clusterSummaryEl.textContent = `Leader: unknown · term: ${term ?? "?"}`;
    return;
  }

  const leaderName = map.get(leaderReplica.address) || "Unassigned";
  clusterSummaryEl.textContent = `Leader: ${leaderName} · term: ${term ?? "?"}`;
}

function renderUsers(users) {
  const safeUsers = Array.isArray(users) ? users : [];
  usersSummaryEl.textContent = `${safeUsers.length} active`;
  userListEl.innerHTML = "";

  for (const name of safeUsers) {
    const li = document.createElement("li");
    li.textContent = name;
    userListEl.appendChild(li);
  }
}

function wsUrl(name) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const gatewayPort = window.GATEWAY_PORT || "8080";
  const query = name ? `?name=${encodeURIComponent(name)}` : "";
  return `${protocol}://${host}:${gatewayPort}${query}`;
}

function sendIntroduce() {
  if (!socket || socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify({ type: "introduce", name: currentUserName }));
}

function connect() {
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
    return;
  }

  currentUserName = normalizeUserName(nameInput.value);
  nameInput.value = currentUserName;
  selfNameEl.textContent = `Connected as: ${currentUserName}`;
  connectBtn.disabled = true;
  disconnectBtn.disabled = false;
  nameInput.disabled = true;
  setStatus("Connecting...", "connecting");

  socket = new WebSocket(wsUrl(currentUserName));

  socket.addEventListener("open", () => {
    setStatus("Connected", "connected");
    sendIntroduce();
  });

  socket.addEventListener("close", () => {
    setStatus("Disconnected - click Connect to rejoin", "disconnected");
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    nameInput.disabled = false;
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
      const term = payload.term;
      const replicas = Array.isArray(payload.replicas) ? payload.replicas : [];
      latestReplicas = replicas;
      latestTerm = term;
      updateClusterSummary(latestReplicas, latestUsers, term);
      renderReplicaCards(latestReplicas, latestUsers);
    }
    if (payload.type === "users") {
      latestUsers = Array.isArray(payload.users) ? payload.users : [];
      renderUsers(latestUsers);
      updateClusterSummary(latestReplicas, latestUsers, latestTerm);
      renderReplicaCards(latestReplicas, latestUsers);
    }
    if (payload.type === "welcome") {
      selfNameEl.textContent = `Connected as: ${payload.name}`;
    }
    if (payload.type === "stroke" && payload.entry?.stroke) {
      drawStroke(payload.entry.stroke);
    }
  });
}

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
    user: currentUserName,
  };
  drawStroke(stroke);
  if (socket && socket.readyState === 1) {
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

disconnectBtn.addEventListener("click", () => {
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "disconnect" }));
    socket.close();
  }
  selfNameEl.textContent = "Not connected";
  currentUserName = "";
  setStatus("Disconnected", "disconnected");
});

connectBtn.addEventListener("click", () => {
  connect();
});

nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    connect();
  }
});

renderUsers([]);
renderReplicaCards([], []);
setStatus("Enter your name and click Connect", "connecting");
