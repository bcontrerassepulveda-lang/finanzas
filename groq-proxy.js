const http = require("http");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = Number(process.env.GROQ_PROXY_PORT || 8787);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  if (req.url !== "/groq" || req.method !== "POST") {
    sendJson(res, 404, { error: "Ruta no encontrada" });
    return;
  }
  if (!GROQ_API_KEY) {
    sendJson(res, 500, { error: "Falta configurar GROQ_API_KEY en el entorno local del proxy." });
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2_000_000) req.destroy();
  });
  req.on("end", async () => {
    try {
      const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body,
      });
      const data = await upstream.json().catch(() => ({}));
      sendJson(res, upstream.status, data);
    } catch (error) {
      sendJson(res, 500, { error: error.message || String(error) });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Groq proxy listo en http://localhost:${PORT}/groq`);
});
