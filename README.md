# Local Login Rate-Limit Demo

A small, local-only demonstration of server-side login throttling. It uses a fake account and does not connect to Facebook or any other service.

## Run

Requires Node.js 18 or newer. From this directory:

```sh
npm start
```

Open <http://127.0.0.1:3000>. The demo credentials are `demo` and `local-demo-passphrase`. Five failed attempts per client IP or account are permitted in a 60-second window; additional requests receive HTTP 429 and a `Retry-After` header.

Run the tests with:

```sh
npm test
```

## Scope

The limiter is in-memory and intended only for local learning. A production service needs persistent/shared rate-limit storage, deliberate proxy/IP handling, monitoring, secure password storage, and other account protections. No external password lists are included or used.
