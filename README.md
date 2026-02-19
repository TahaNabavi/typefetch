# TypeFetch

TypeFetch is a production-grade, strongly-typed HTTP client built on
**TypeScript** and **Zod**.

Define your API once using Zod schemas, and TypeFetch generates a fully
type-safe client with:

- End-to-end type safety
- Structured request support: `{ path, query, body, headers }`
- Automatic URL handling (path parameters, query string, JSON body)
- Middleware pipeline (logging, retry, cache, auth, custom)
- Built-in retry engine with backoff strategies
- Timeout & AbortController support
- Mock mode for development
- Dynamic token providers
- Response wrappers for consistent API envelopes
- Unified error system (`RichError`)
- Optional `form-data` body support for file uploads
- Concurrency-safe request handling
- Production-grade validation and error normalization

---

## Installation

```bash
npm install @tahanabavi/typefetch
# or
yarn add @tahanabavi/typefetch
```

---

# What's New / Updated

## 1. Advanced Retry Engine

TypeFetch now includes:

- Configurable `maxRetries`
- Custom `retryCondition`
- Built-in backoff strategies:
  - `fixed`
  - `exponential`
- Fully normalized retry errors

Example:

```ts
client.setRetryConfig({
  maxRetries: 3,
  backoff: "exponential",
  retryCondition: (err) => err.status === 500,
});
```

---

## 2. Backoff Strategies

Supported strategies:

- **fixed** → constant delay
- **exponential** → 100ms, 200ms, 400ms...

Backoff is applied automatically between retries.

---

## 3. Timeout & Abort Support

Per-request timeout:

```ts
await api.user.getUser({ path: { id: "123" } }, { timeout: 5000 });
```

Internally uses `AbortController` for safe cancellation.

---

## 4. Structured Request Model (Canonical Format)

```ts
z.object({
  path: z.object({...}).optional(),
  query: z.object({...}).optional(),
  body: z.object({...}).optional(),
  headers: z.record(z.string()).optional(),
})
```

TypeFetch automatically:

- Injects path params
- Builds query string
- Serializes JSON body
- Merges headers in priority order:
  1.  auth
  2.  endpoint-level headers
  3.  per-call headers

---

## 5. Backward Compatibility

Flat request schemas still work:

```ts
z.object({
  name: z.string(),
});
```

For non-GET requests, the entire object becomes the JSON body.

---

# Defining API Contracts

Example:

```ts
import { z } from "zod";

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      auth: true,
      request: z.object({
        path: z.object({ id: z.string() }),
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
      }),
    },
  },
} as const;
```

---

# Using ApiClient

```ts
import { ApiClient } from "@tahanabavi/typefetch";

const client = new ApiClient(
  {
    baseUrl: "https://api.example.com",
    tokenProvider: async () => "dynamic-token",
  },
  contracts,
);

client.init();

const api = client.modules;

const user = await api.user.getUser({ path: { id: "123" } });
```

---

# Middleware System

Middlewares execute in reverse registration order.

## Custom Middleware

```ts
client.use(async (ctx, next) => {
  console.log("Request:", ctx.url);
  const res = await next();
  console.log("Response:", res.status);
  return res;
});
```

## Built-in Middlewares

- `loggingMiddleware`
- `retryMiddleware`
- `cacheMiddleware`
- `authMiddleware`

Example:

```ts
client.use(loggingMiddleware);
client.use(retryMiddleware, { maxRetries: 3 });
client.use(cacheMiddleware, { ttl: 60000 });
client.use(authMiddleware);
```

---

# Mock Mode

```ts
client.setMockMode(true, { min: 200, max: 1000 });
```

- Returns `mockData` instead of calling network
- Still applies response validation and wrapper

---

# Response Wrapper

Supports envelope APIs:

```json
{
  "success": true,
  "data": {...},
  "timestamp": "..."
}
```

Example:

```ts
client.setResponseWrapper(wrapperSchema);
```

On failure, throws normalized `RichError`.

---

# Error Handling

All errors are normalized into `RichError`:

- HTTP errors
- Network failures
- Validation errors
- Timeout errors
- Retry exhaustion

Global handler:

```ts
client.onError((err) => {
  console.error(err.message, err.status);
});
```

---

# File Uploads (FormData)

Set `bodyType: "form-data"` in endpoint definition.

TypeFetch builds `FormData` automatically.

---

# Concurrency Safety

TypeFetch safely handles parallel requests:

- No shared mutable state issues
- Independent retry cycles
- Independent AbortControllers

---

# Production-Grade Test Coverage

The project now includes:

- Validation tests
- Middleware tests
- Retry tests
- Backoff timing tests
- Timeout & abort tests
- Concurrency tests
- Error propagation tests
- Mock mode tests
- TokenProvider tests
- Edge case handling tests

Suitable for publishing as a production SDK.

---

# Notes

- Always call `client.init()` before using modules.
- All responses are validated via Zod.
- Structured request shape is recommended.
- Retry + Timeout can be combined safely.

---

# License

MIT
