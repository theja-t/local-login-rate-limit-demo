import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(directory, "public");
const demoCredentials = {
  username: "demo",
  password: "local-demo-passphrase",
};

export class FixedWindowRateLimiter {
  constructor({ limit = 5, windowMs = 60_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  retryAfter(key, now = Date.now()) {
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      this.buckets.delete(key);
      return 0;
    }

    return bucket.count >= this.limit
      ? Math.ceil((bucket.startedAt + this.windowMs - now) / 1000)
      : 0;
  }

  recordFailure(key, now = Date.now()) {
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      bucket = { startedAt: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return this.retryAfter(key, now);
  }

  clear(key) {
    this.buckets.delete(key);
  }
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
  }
  return JSON.parse(body);
}

export function createAppServer({
  limiter = new FixedWindowRateLimiter(),
  credentials = demoCredentials,
} = {}) {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'");

    const path = new URL(request.url, "http://localhost").pathname;
    if (
      request.method === "GET" &&
      (path === "/" || path === "/index.html" || path === "/style.css" || path === "/app.js")
    ) {
      const fileName = path === "/" ? "index.html" : path.slice(1);
      const contentTypes = {
        "app.js": "text/javascript; charset=utf-8",
        "index.html": "text/html; charset=utf-8",
        "style.css": "text/css; charset=utf-8",
      };
      response.writeHead(200, {
        "Content-Type": contentTypes[fileName],
        "Cache-Control": "no-store",
      });
      createReadStream(join(publicDirectory, fileName)).pipe(response);
      return;
    }

    if (path !== "/api/login" || request.method !== "POST") {
      sendJson(response, 404, { message: "Not found" });
      return;
    }

    let submitted;
    try {
      submitted = await readJson(request);
    } catch (error) {
      sendJson(response, error.statusCode ?? 400, { message: "Invalid request" });
      return;
    }

    if (
      typeof submitted?.username !== "string" ||
      typeof submitted?.password !== "string" ||
      submitted.username.length > 128 ||
      submitted.password.length > 256
    ) {
      sendJson(response, 400, { message: "Enter a username and password." });
      return;
    }

    const username = submitted.username.trim().toLowerCase();
    const address = request.socket.remoteAddress ?? "unknown";
    const ipKey = `ip:${address}`;
    const accountKey = `account:${address}:${username}`;
    const retryAfter = Math.max(
      limiter.retryAfter(ipKey),
      limiter.retryAfter(accountKey),
    );

    if (retryAfter > 0) {
      sendJson(
        response,
        429,
        { message: "Too many failed attempts. Wait before trying again." },
        { "Retry-After": String(retryAfter) },
      );
      return;
    }

    if (
      username === credentials.username &&
      submitted.password === credentials.password
    ) {
      limiter.clear(accountKey);
      sendJson(response, 200, { message: "Signed in to the local demo." });
      return;
    }

    const ipRetryAfter = limiter.recordFailure(ipKey);
    const accountRetryAfter = limiter.recordFailure(accountKey);
    const failedRetryAfter = Math.max(ipRetryAfter, accountRetryAfter);
    if (failedRetryAfter > 0) {
      sendJson(
        response,
        429,
        { message: "Too many failed attempts. Wait before trying again." },
        { "Retry-After": String(failedRetryAfter) },
      );
      return;
    }

    sendJson(response, 401, { message: "Username or password is incorrect." });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  createAppServer().listen(port, "127.0.0.1", () => {
    console.log(`Local rate-limit demo running at http://127.0.0.1:${port}`);
  });
}
