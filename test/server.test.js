import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppServer, FixedWindowRateLimiter } from "../server.js";

async function withServer(callback, limiter = new FixedWindowRateLimiter()) {
  const server = createAppServer({ limiter });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("rate limiter blocks after the configured number of failures", async () => {
  await withServer(async (baseUrl) => {
    const attempt = () =>
      fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "wrong-user", password: "wrong-password" }),
      });

    assert.equal((await attempt()).status, 401);
    const limitedResponse = await attempt();
    assert.equal(limitedResponse.status, 429);
    assert.ok(Number(limitedResponse.headers.get("Retry-After")) > 0);
    assert.equal((await attempt()).status, 429);
  }, new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000 }));
});

test("local demo credentials work", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "local-demo-passphrase" }),
    });
    assert.equal(response.status, 200);
  });
});

test("login page and browser script are served with the expected policy", async () => {
  await withServer(async (baseUrl) => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("Content-Security-Policy"), /default-src 'self'/);
    assert.match(await page.text(), /src="\/app\.js" defer/);

    const script = await fetch(`${baseUrl}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("Content-Type"), /javascript/);
  });
});

test("login endpoint rejects malformed and oversized input", async () => {
  await withServer(async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);

    const oversized = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "x".repeat(5000), password: "bad" }),
    });
    assert.equal(oversized.status, 413);
  });
});
