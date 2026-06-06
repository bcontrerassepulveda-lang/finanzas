const functions = require("firebase-functions");

const defaultOrigins = [
  "https://bcontrerassepulveda-lang.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function getAllowedOrigins() {
  const origins = new Set(defaultOrigins);
  const corsConfig = functions.config().cors;
  if (corsConfig && corsConfig.origins) {
    corsConfig.origins
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((origin) => origins.add(origin));
  }
  return origins;
}

function applyCors(req, res) {
  const origin = req.get("origin") || "";
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

exports.groq = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Metodo no permitido" });
      return;
    }

    const apiKey = functions.config().groq && functions.config().groq.key;
    if (!apiKey) {
      res.status(500).json({ error: "Falta configurar groq.key en Firebase Functions." });
      return;
    }

    try {
      const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(req.body || {}),
      });
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });
