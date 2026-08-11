import { createId, createSecret, hashSecret } from "./ids.js";
import { ServiceError } from "./errors.js";

const COOKIE_NAME = "magtopia_player_session";

export function installPlayerSessions({ app, repository, config }) {
  const originalAuthenticate = repository.authenticate.bind(repository);

  repository.authenticate = async (token) => {
    if (!token?.startsWith("mts_")) return originalAuthenticate(token);
    const result = await repository.database.query(
      `UPDATE player_sessions s SET last_used_at = now()
       FROM players p
       WHERE s.token_hash = $1 AND s.player_id = p.id
         AND s.revoked_at IS NULL AND s.expires_at > now()
       RETURNING p.id, p.display_name`,
      [hashSecret(token)]
    );
    if (!result.rowCount) throw new ServiceError(401, "INVALID_PLAYER_SESSION", "Player session is invalid or expired");
    return { kind: "player", id: result.rows[0].id, displayName: result.rows[0].display_name, scopes: ["*"] };
  };

  // The browser deliberately sends the opaque `session` sentinel. The actual
  // session secret remains HttpOnly and is substituted before Fastify handles
  // the request, so application routes can keep using the existing Bearer
  // authentication boundary without exposing the secret to JavaScript.
  app.server.prependListener("request", (request) => {
    if (request.headers.authorization !== "Bearer session") return;
    const sessionToken = readCookie(request.headers.cookie, COOKIE_NAME);
    if (sessionToken) request.headers.authorization = `Bearer ${sessionToken}`;
  });

  app.post("/api/v1/player-session", async (request, reply) => {
    const authorization = request.headers.authorization ?? "";
    const match = /^Bearer\s+(mtp_.+)$/i.exec(authorization);
    if (!match) throw new ServiceError(401, "PLAYER_CREDENTIAL_REQUIRED", "Player credential is required to create a session");
    const principal = await originalAuthenticate(match[1]);
    if (principal.kind !== "player") throw new ServiceError(403, "PLAYER_REQUIRED", "Player credential is required");

    const id = createId("session");
    const token = createSecret("mts");
    const ttlDays = Number(config.playerSessionTtlDays ?? 90);
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    await repository.database.query(
      `INSERT INTO player_sessions(id, player_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [id, principal.id, hashSecret(token), expiresAt]
    );

    reply.header("Cache-Control", "no-store");
    reply.header("Set-Cookie", serializeCookie(token, expiresAt, config.publicBaseUrl));
    return { authenticated: true, player: { id: principal.id, display_name: principal.displayName }, expires_at: expiresAt.toISOString() };
  });

  app.delete("/api/v1/player-session", async (request, reply) => {
    const token = readCookie(request.headers.cookie, COOKIE_NAME);
    if (token) await repository.database.query("UPDATE player_sessions SET revoked_at = now() WHERE token_hash = $1", [hashSecret(token)]);
    reply.header("Set-Cookie", clearCookie(config.publicBaseUrl));
    return { authenticated: false };
  });
}

function readCookie(header = "", name) {
  for (const part of String(header).split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function serializeCookie(token, expiresAt, publicBaseUrl) {
  const secure = String(publicBaseUrl ?? "").startsWith("https://") ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

function clearCookie(publicBaseUrl) {
  const secure = String(publicBaseUrl ?? "").startsWith("https://") ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
