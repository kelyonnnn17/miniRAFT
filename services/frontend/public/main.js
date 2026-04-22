const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const authForm = document.getElementById("auth-form");
const authCard = document.getElementById("auth-form-wrap");
const userIdInput = document.getElementById("user-id");
const boardIdInput = document.getElementById("board-id");
const authError = document.getElementById("auth-error");
const boardPanel = document.getElementById("board-panel");
const brushSizeInput = document.getElementById("brush-size");
const brushValue = document.getElementById("brush-value");
const clearBoardButton = document.getElementById("clear-board");
const toolButtons = Array.from(document.querySelectorAll("[data-tool]"));
const colorButtons = Array.from(document.querySelectorAll("[data-color]"));
const customColorInput = document.getElementById("custom-color");

const gatewayHost = window.GATEWAY_HOST || window.location.hostname;
const gatewayPort = window.GATEWAY_PORT || "8080";
const gatewayBase = `${window.location.protocol}//${gatewayHost}:${gatewayPort}`;

let drawing = false;
let lastPoint = null;
let socket = null;
let accessToken = localStorage.getItem("miniraftToken") || "";
let currentIdentity = null;
let activeTool = "pen";
let activeColor = localStorage.getItem("miniraftColor") || "#111111";
let activeBrushSize = Number(localStorage.getItem("miniraftBrushSize") || "3");

if (!/^#[0-9a-f]{6}$/i.test(activeColor)) {
  activeColor = "#111111";
}

function getStrokeColor() {
  return activeTool === "eraser" ? "#ffffff" : activeColor;
}

function getStrokeWidth() {
  return activeTool === "eraser" ? Math.max(activeBrushSize + 6, 10) : activeBrushSize;
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

function applyOperation(operation) {
  if (!operation) return;

  if (operation.type === "clear") {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  if (operation.type === "stroke") {
    drawStroke(operation);
  }
}

function setActiveTool(tool) {
  activeTool = tool;
  toolButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
}

function setActiveColor(color) {
  activeColor = color;
  localStorage.setItem("miniraftColor", color);
  colorButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.color === color);
  });
  if (customColorInput) {
    customColorInput.value = color;
  }
}

function setBrushSize(size) {
  activeBrushSize = size;
  brushValue.textContent = String(size);
  brushSizeInput.value = String(size);
  localStorage.setItem("miniraftBrushSize", String(size));
}

function setStatus(text) {
  statusEl.textContent = text;
}

function connectSocket(token) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  socket = new WebSocket(`${gatewayBase}/?token=${encodeURIComponent(token)}`);

  socket.addEventListener("open", () => {
    setStatus(`Connected as ${currentIdentity?.userId || "user"}`);
  });

  socket.addEventListener("close", () => {
    setStatus("Disconnected");
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "snapshot") {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const entry of payload.entries || []) {
        applyOperation(entry.operation || entry.stroke);
      }
    }
    if (payload.type === "operation" && payload.entry?.operation) {
      applyOperation(payload.entry.operation);
    }
    if (payload.type === "error") {
      setStatus(payload.message);
    }
  });
}

async function authenticate(userId, boardId) {
  const response = await fetch(`${gatewayBase}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, boardId, role: "editor" }),
  });

  if (!response.ok) {
    throw new Error("failed to authenticate");
  }

  return response.json();
}

async function ensureAuthenticated() {
  if (accessToken) {
    const existingUserId = localStorage.getItem("miniraftUserId");
    const existingBoardId = localStorage.getItem("miniraftBoardId") || "default";
    currentIdentity = { userId: existingUserId || "user", boardId: existingBoardId };
    return true;
  }

  return false;
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";

  try {
    const userId = userIdInput.value.trim();
    const boardId = boardIdInput.value.trim() || "default";
    const result = await authenticate(userId, boardId);
    accessToken = result.token;
    currentIdentity = result.user;
    localStorage.setItem("miniraftToken", accessToken);
    localStorage.setItem("miniraftUserId", currentIdentity.userId);
    localStorage.setItem("miniraftBoardId", currentIdentity.boardId);
    authCard.hidden = true;
    boardPanel.hidden = false;
    connectSocket(accessToken);
  } catch (error) {
    authError.textContent = error.message || "authentication failed";
  }
});

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  lastPoint = { x: event.offsetX, y: event.offsetY };
});

canvas.addEventListener("pointermove", (event) => {
  if (!drawing || !lastPoint || !socket || socket.readyState !== WebSocket.OPEN) return;
  const nextPoint = { x: event.offsetX, y: event.offsetY };
  const stroke = {
    type: "stroke",
    tool: activeTool,
    from: lastPoint,
    to: nextPoint,
    color: getStrokeColor(),
    width: getStrokeWidth(),
  };
  drawStroke(stroke);
  socket.send(JSON.stringify({ type: "stroke", operation: stroke }));
  lastPoint = nextPoint;
});

window.addEventListener("pointerup", () => {
  drawing = false;
  lastPoint = null;
});

canvas.addEventListener("pointerleave", () => {
  drawing = false;
  lastPoint = null;
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTool(button.dataset.tool);
  });
});

colorButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveColor(button.dataset.color);
    setActiveTool("pen");
  });
});

customColorInput?.addEventListener("input", () => {
  setActiveColor(customColorInput.value);
  setActiveTool("pen");
});

brushSizeInput.addEventListener("input", () => {
  setBrushSize(Number(brushSizeInput.value));
});

clearBoardButton.addEventListener("click", () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "clear", operation: { type: "clear" } }));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

window.addEventListener("load", async () => {
  setActiveColor(activeColor);
  setBrushSize(Number.isFinite(activeBrushSize) && activeBrushSize > 0 ? activeBrushSize : 3);
  setActiveTool("pen");
  const hasToken = await ensureAuthenticated();
  if (hasToken) {
    authCard.hidden = true;
    boardPanel.hidden = false;
    connectSocket(accessToken);
    setStatus(`Ready for ${currentIdentity.userId}`);
  } else {
    authCard.hidden = false;
    boardPanel.hidden = true;
    setStatus("Sign in to draw");
  }
});
