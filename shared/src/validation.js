export function normalizeDrawingOperation(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "operation must be an object" };
  }

  if (input.type === "clear") {
    return {
      ok: true,
      value: { type: "clear" },
    };
  }

  const { from, to, color, width, tool } = input;
  const pointKeys = ["x", "y"];
  for (const point of [from, to]) {
    if (!point || typeof point !== "object") {
      return { ok: false, error: "stroke points must be objects" };
    }
    for (const key of pointKeys) {
      if (typeof point[key] !== "number" || Number.isNaN(point[key])) {
        return { ok: false, error: `stroke.${key} must be a number` };
      }
    }
  }

  if (color !== undefined && typeof color !== "string") {
    return { ok: false, error: "stroke.color must be a string" };
  }

  if (width !== undefined && (typeof width !== "number" || width <= 0)) {
    return { ok: false, error: "stroke.width must be a positive number" };
  }

  if (tool !== undefined && !["pen", "eraser"].includes(tool)) {
    return { ok: false, error: "stroke.tool must be pen or eraser" };
  }

  return {
    ok: true,
    value: {
      type: "stroke",
      tool: tool || "pen",
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      color: color || "#111827",
      width: width || 3,
    },
  };
}

export function normalizeStroke(input) {
  const normalized = normalizeDrawingOperation(input);
  if (!normalized.ok || normalized.value.type !== "stroke") {
    return normalized.ok ? { ok: false, error: "stroke expected" } : normalized;
  }

  return normalized;
}

export function normalizeAuthRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "request body required" };
  }

  const { userId, boardId, role } = body;
  if (typeof userId !== "string" || !userId.trim()) {
    return { ok: false, error: "userId is required" };
  }

  if (boardId !== undefined && typeof boardId !== "string") {
    return { ok: false, error: "boardId must be a string" };
  }

  if (role !== undefined && !["editor", "viewer"].includes(role)) {
    return { ok: false, error: "role must be editor or viewer" };
  }

  return {
    ok: true,
    value: {
      userId: userId.trim(),
      boardId: boardId?.trim() || "default",
      role: role || "editor",
    },
  };
}
