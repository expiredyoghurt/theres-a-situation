import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = process.argv[2]; const port = Number(process.argv[3] || 8791);
const { default: worker } = await import(path.join(root, "worker/index.js"));
const stmt = (sql) => { const mk = () => ({ run: async () => ({ meta: {} }), first: async () => null, all: async () => ({ results: [] }) }); return { bind: () => mk(), ...mk() }; };
const env = { DB: { prepare: stmt, batch: async () => [] }, ASSETS: { fetch: async () => new Response("no", { status: 404 }) } };
const types = { ".html": "text/html", ".md": "text/markdown", ".js": "text/javascript" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(u, { method: req.method, headers: req.headers, body: ["GET","HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, {});
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join(root, "public", u.pathname === "/" ? "index.html" : u.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f));
}).listen(port, () => console.log("up " + port));
