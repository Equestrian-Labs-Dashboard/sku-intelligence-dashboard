let jwksCache = { url: "", ts: 0, keys: [] };

function b64urlToBytes(value) {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(value)));
}

function normalizeDomain(v) {
  return String(v || "").trim().replace(/\/+$/, "");
}

async function getJwks(teamDomain) {
  const base = normalizeDomain(teamDomain);
  if (!base) throw new Error("ACCESS_TEAM_DOMAIN is not configured");
  const url = `${base}/cdn-cgi/access/certs`;
  if (jwksCache.url === url && Date.now() - jwksCache.ts < 60 * 60 * 1000 && jwksCache.keys.length) {
    return jwksCache.keys;
  }
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Could not load Access signing keys (${r.status})`);
  const d = await r.json();
  const keys = Array.isArray(d.keys) ? d.keys : [];
  if (!keys.length) throw new Error("Cloudflare Access returned no signing keys");
  jwksCache = { url, ts: Date.now(), keys };
  return keys;
}

function audMatches(payloadAud, expected) {
  if (Array.isArray(payloadAud)) return payloadAud.includes(expected);
  return String(payloadAud || "") === expected;
}

export async function verifyAccessRequest(request, env) {
  const teamDomain = normalizeDomain(env.ACCESS_TEAM_DOMAIN);
  const expectedAud = String(env.ACCESS_AUD || "").trim();
  if (!teamDomain || !expectedAud) throw new Error("Cloudflare Access environment is incomplete");

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    const err = new Error("Missing Cloudflare Access JWT");
    err.status = 401;
    err.code = "access_jwt_missing";
    throw err;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    const err = new Error("Invalid Cloudflare Access JWT");
    err.status = 401;
    err.code = "access_jwt_invalid";
    throw err;
  }

  let header, payload;
  try {
    header = decodeJsonPart(parts[0]);
    payload = decodeJsonPart(parts[1]);
  } catch (_) {
    const err = new Error("Invalid Cloudflare Access JWT encoding");
    err.status = 401;
    err.code = "access_jwt_invalid";
    throw err;
  }

  if (header.alg !== "RS256" || !header.kid) {
    const err = new Error("Unsupported Cloudflare Access JWT");
    err.status = 401;
    err.code = "access_jwt_invalid";
    throw err;
  }

  const keys = await getJwks(teamDomain);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) {
    jwksCache = { url: "", ts: 0, keys: [] };
    const refreshed = await getJwks(teamDomain);
    const retryJwk = refreshed.find(k => k.kid === header.kid);
    if (!retryJwk) {
      const err = new Error("Cloudflare Access signing key not found");
      err.status = 401;
      err.code = "access_jwt_invalid";
      throw err;
    }
    return verifyWithJwk(parts, payload, retryJwk, teamDomain, expectedAud);
  }
  return verifyWithJwk(parts, payload, jwk, teamDomain, expectedAud);
}

async function verifyWithJwk(parts, payload, jwk, teamDomain, expectedAud) {
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = b64urlToBytes(parts[2]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!ok) {
    const err = new Error("Cloudflare Access JWT signature check failed");
    err.status = 401;
    err.code = "access_jwt_invalid";
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  if (String(payload.iss || "").replace(/\/+$/, "") !== teamDomain) {
    const err = new Error("Cloudflare Access issuer mismatch");
    err.status = 401;
    err.code = "access_jwt_invalid";
    throw err;
  }
  if (!audMatches(payload.aud, expectedAud)) {
    const err = new Error("Cloudflare Access audience mismatch");
    err.status = 401;
    err.code = "access_jwt_invalid";
    throw err;
  }
  if (!payload.exp || Number(payload.exp) <= now) {
    const err = new Error("Cloudflare Access session expired");
    err.status = 401;
    err.code = "access_jwt_expired";
    throw err;
  }
  if (payload.nbf && Number(payload.nbf) > now + 30) {
    const err = new Error("Cloudflare Access token is not active yet");
    err.status = 401;
    err.code = "access_jwt_invalid";
    throw err;
  }
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) {
    const err = new Error("Cloudflare Access did not provide an email address");
    err.status = 401;
    err.code = "access_email_missing";
    throw err;
  }
  return { email, payload };
}
