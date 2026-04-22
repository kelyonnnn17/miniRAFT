import crypto from "node:crypto";

const DEFAULT_SECRET = process.env.MINIRAFT_AUTH_SECRET || "dev-secret-change-me";
const TOKEN_TTL_SECONDS = Number(process.env.MINIRAFT_TOKEN_TTL_SECONDS || 60 * 60 * 24);

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf-8");
}

function sign(data, secret = DEFAULT_SECRET) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function createTokenPayload({ userId, boardId = "default", role = "editor" }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    sub: userId,
    boardId,
    role,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  };
}

export function createToken(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${headerEncoded}.${payloadEncoded}`);
  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

export function issueToken({ userId, boardId = "default", role = "editor" }) {
  return createToken(createTokenPayload({ userId, boardId, role }));
}

export function verifyToken(token, secret = DEFAULT_SECRET) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "missing_token" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "malformed_token" };
  }

  const [headerEncoded, payloadEncoded, providedSignature] = parts;
  const expectedSignature = sign(`${headerEncoded}.${payloadEncoded}`, secret);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return { valid: false, reason: "invalid_signature" };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && payload.exp < now) {
      return { valid: false, reason: "token_expired" };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
}

export function extractBearerToken(headerValue) {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}
