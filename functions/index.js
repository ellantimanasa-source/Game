const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function isHexProof(value) {
  return typeof value === "string" && /^[0-9a-f]{6,32}$/.test(value);
}

function sanitizeName(name) {
  if (typeof name !== "string") return "Guest";
  const trimmed = name.trim().slice(0, 12);
  return trimmed || "Guest";
}

function validatePayload(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "bad payload" };

  const data = {
    name: sanitizeName(raw.name),
    score: toInt(raw.score),
    createdAt: toInt(raw.createdAt),
    playTimeMs: toInt(raw.playTimeMs),
    jumps: toInt(raw.jumps),
    coinsCollected: toInt(raw.coinsCollected),
    policeClears: toInt(raw.policeClears),
    harvardClears: toInt(raw.harvardClears),
    superCollectibles: toInt(raw.superCollectibles),
    flyTimeMs: toInt(raw.flyTimeMs),
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "",
    proof: raw.proof,
    integrityVersion: toInt(raw.integrityVersion)
  };

  const keys = Object.keys(raw).sort().join(",");
  const expectedKeys = [
    "coinsCollected",
    "createdAt",
    "flyTimeMs",
    "harvardClears",
    "integrityVersion",
    "jumps",
    "name",
    "playTimeMs",
    "policeClears",
    "proof",
    "score",
    "sessionId",
    "superCollectibles"
  ].sort().join(",");
  if (keys !== expectedKeys) return { ok: false, error: "unexpected fields" };

  if (
    data.score === null ||
    data.createdAt === null ||
    data.playTimeMs === null ||
    data.jumps === null ||
    data.coinsCollected === null ||
    data.policeClears === null ||
    data.harvardClears === null ||
    data.superCollectibles === null ||
    data.flyTimeMs === null ||
    data.integrityVersion === null
  ) {
    return { ok: false, error: "invalid number fields" };
  }

  if (data.integrityVersion !== 2) return { ok: false, error: "version mismatch" };
  if (!isHexProof(data.proof)) return { ok: false, error: "bad proof" };
  if (data.sessionId.length < 10 || data.sessionId.length > 60) return { ok: false, error: "bad session" };
  if (data.score < 0 || data.score > 200000) return { ok: false, error: "bad score" };
  if (data.playTimeMs < 1800 || data.playTimeMs > 60 * 60 * 1000) return { ok: false, error: "bad playtime" };
  if (data.jumps < 0 || data.coinsCollected < 0 || data.policeClears < 0 || data.harvardClears < 0 || data.superCollectibles < 0 || data.flyTimeMs < 0) {
    return { ok: false, error: "negative telemetry" };
  }
  if (data.flyTimeMs > data.playTimeMs) return { ok: false, error: "bad fly time" };

  const now = Date.now();
  if (Math.abs(data.createdAt - now) > 5 * 60 * 1000) return { ok: false, error: "stale timestamp" };

  const minPlausibleMs = Math.max(1800, data.score * 45);
  if (data.playTimeMs < minPlausibleMs) return { ok: false, error: "impossible score/time" };

  const baseFromActions =
    Math.floor(data.playTimeMs / 1000) * 11 +
    data.coinsCollected * 30 +
    data.policeClears * 18 +
    data.harvardClears * 45 +
    data.superCollectibles * 120;
  if (data.score > baseFromActions + 320) return { ok: false, error: "impossible score/actions" };

  const maxLikelyJumps = Math.floor(data.playTimeMs / 120) + 220;
  if (data.jumps > maxLikelyJumps) return { ok: false, error: "impossible jumps" };

  return { ok: true, data };
}

exports.submitScore = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  const check = validatePayload(req.body);
  if (!check.ok) {
    res.status(400).json({ ok: false, error: check.error });
    return;
  }

  try {
    const db = admin.firestore();
    await db.collection("scores").add(check.data);

    // Compute exact rank as (count of strictly higher scores) + 1.
    // Uses server-side count aggregation to avoid downloading full results.
    const higherAgg = await db
      .collection("scores")
      .where("score", ">", check.data.score)
      .count()
      .get();
    const higherCount = higherAgg.data().count || 0;
    const rank = higherCount + 1;

    res.status(200).json({ ok: true, rank });
  } catch (error) {
    res.status(500).json({ ok: false, error: "write failed" });
  }
});
