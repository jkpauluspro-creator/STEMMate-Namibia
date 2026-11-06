
// STEMMate Namibia — local demonstration receiving server.
// Uses fictional data only. Not suitable for public deployment.

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "server-data");
const DATA_FILE = path.join(DATA_DIR, "received-plans.json");
const PORT = Number(process.env.PORT || 8080);

const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]]
]);

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  res.end(JSON.stringify(body));
}

async function readRecords() {
  try {
    const data = JSON.parse(
      await fs.readFile(DATA_FILE, "utf8")
    );

    return Array.isArray(data) ? data : [];

  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function validPlan(p) {
  if (!p || typeof p !== "object") return false;

  const text = (key, limit) =>
    typeof p[key] === "string" &&
    p[key].trim().length > 0 &&
    p[key].length <= limit;

  return (
    typeof p.id === "string" &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(p.id) &&
    text("activityId", 100) &&
    text("activityTitle", 120) &&
    text("title", 100) &&
    text("steps", 10000) &&
    text("safety", 5000) &&
    Number.isInteger(p.duration) &&
    p.duration >= 1 &&
    p.duration <= 480 &&
    text("createdAt", 50)
  );
}

async function readRequest(req) {
  let input = "";

  for await (const chunk of req) {
    input += chunk.toString("utf8");

    if (Buffer.byteLength(input) > 65536) {
      const err = new Error("Request too large");
      err.status = 413;
      throw err;
    }
  }

  try {
    return JSON.parse(input);
  } catch {
    const err = new Error("Invalid JSON");
    err.status = 400;
    throw err;
  }
}

// Serialise writes so concurrent requests don't overwrite each other.
let writeQueue = Promise.resolve();

function saveReceipt(plan) {
  const task = writeQueue.then(async () => {
    const records = await readRecords();

    const existing = records.find(x => x.id === plan.id);

    // Retrying the same plan must not create a duplicate.
    if (existing) return existing;

    const received = {
      ...plan,
      receivedAt: new Date().toISOString()
    };

    records.push(received);

    await fs.mkdir(DATA_DIR, { recursive: true });

    const temp = path.join(
      DATA_DIR,
      `received-${crypto.randomUUID()}.tmp`
    );

    await fs.writeFile(
      temp,
      JSON.stringify(records, null, 2),
      "utf8"
    );

    await fs.rename(temp, DATA_FILE);

    return received;
  });

  writeQueue = task.then(
    () => undefined,
    () => undefined
  );

  return task;
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(
      req.url,
      "http://localhost"
    ).pathname;

    // Check what the receiving service has actually stored.
    if (
      req.method === "GET" &&
      pathname === "/api/received"
    ) {
      const plans = await readRecords();

      return json(res, 200, {
        count: plans.length,
        plans: plans.map(p => ({
          id: p.id,
          title: p.title,
          receivedAt: p.receivedAt
        }))
      });
    }

    // Receive one completed plan.
    if (
      req.method === "POST" &&
      pathname === "/api/plans"
    ) {
      const data = await readRequest(req);

      if (!validPlan(data)) {
        return json(res, 400, {
          error: "Invalid plan data"
        });
      }

      const plan = {
        id: data.id,
        activityId: data.activityId,
        activityTitle: data.activityTitle,
        title: data.title,
        duration: data.duration,
        steps: data.steps,
        safety: data.safety,
        createdAt: data.createdAt
      };

      const receipt = await saveReceipt(plan);

      console.log(
        `Received plan: ${receipt.title} (${receipt.id})`
      );

      return json(res, 200, {
        id: receipt.id,
        receivedAt: receipt.receivedAt
      });
    }

    // Serve STEMMate application files.
    if (
      req.method === "GET" &&
      ASSETS.has(pathname)
    ) {
      const [file, type] = ASSETS.get(pathname);

      const content = await fs.readFile(
        path.join(ROOT, file)
      );

      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
      });

      return res.end(content);
    }

    return json(res, 404, {
      error: "Not found"
    });

  } catch (error) {
    console.error(error);

    return json(res, error.status || 500, {
      error: error.status
        ? error.message
        : "Server error"
    });
  }
});

server.on("error", error => {
  console.error(
    "Could not start receiver:",
    error.message
  );

  process.exitCode = 1;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `STEMMate receiver ready at http://localhost:${PORT}`
  );

  console.log(
    "Use Ctrl+C to stop the receiver for offline testing."
  );
});
