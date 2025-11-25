# TypeFetch

TypeFetch is a strongly-typed HTTP client built on **TypeScript** and **Zod**.

You define your API once using Zod schemas, and TypeFetch generates a fully type-safe client with:

- End-to-end type safety
- Structured request support: `{ path, query, body, headers }`
- Automatic URL handling (path parameters, query string, JSON body)
- Middleware pipeline (logging, retry, cache, auth, custom)
- Mock mode for development
- Dynamic token providers
- Response wrappers for consistent API envelopes
- Unified error system (`RichError`)
- Optional `form-data` body support for file uploads

---

## Installation

```bash
npm install @tahanabavi/typefetch
# or
yarn add @tahanabavi/typefetch
```

---

## Core Concepts

### 1. Type-Safe API Client

Define your API with Zod schemas and get full type safety for request and response types.

Each endpoint has:

- `method`: HTTP verb (`GET | POST | PUT | PATCH | DELETE`)
- `path`: path template (e.g. `/users/:id`)
- `auth?`: whether a token is required
- `request`: Zod schema for the request
- `response`: Zod schema for the response
- `mockData?`: static or dynamic mock response
- `headers?`: static or function-based default headers
- `bodyType?`: `"json"` (default) or `"form-data"`

### 2. Structured Request Shape

The recommended request shape is:

```ts
z.object({
  path: z.object({ ... }).optional(),    // URL params → /users/:id
  query: z.object({ ... }).optional(),   // query string → ?page=1
  body: z.object({ ... }).optional(),    // JSON body
  headers: z.record(z.string()).optional(), // per-call extra headers
})
```

TypeFetch will:

- Replace `:param` segments in the path using `path`
- Build query string from `query`
- Serialize `body` as JSON (or `FormData` if `bodyType: "form-data"`)
- Merge headers from:
  - auth (Authorization)
  - endpoint-level `headers`
  - per-call `headers` in the request (highest priority)

### 3. Backward Compatibility

If your `request` schema is **flat** (e.g. `z.object({ name: z.string() })`) and does **not** contain `path`, `query`, `body`, or `headers`, TypeFetch treats the entire object as the request body for non-GET methods.

This makes migration to the structured format incremental and safe.

---

## Defining API Contracts

Example contract definition:

```ts
import { z } from "zod";
import { Contracts, EndpointDef } from "@tahanabavi/typefetch";

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      auth: true,
      request: z.object({
        path: z.object({ id: z.string() }).optional(),
        query: z.object({}).optional(),
        body: z.never().optional(),
        headers: z.record(z.string()).optional(),
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
      }),
      mockData: { id: "1", name: "John Doe" },
    },

    createUser: {
      method: "POST",
      path: "/users",
      auth: true,
      request: z.object({
        path: z.object({}).optional(),
        query: z.object({}).optional(),
        body: z
          .object({
            name: z.string(),
          })
          .optional(),
        headers: z.record(z.string()).optional(),
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
      }),
      mockData: () => ({
        id: Math.random().toString(36).slice(2),
        name: "Mock User",
      }),
    },
  },
} as const;
```

You **do not** have to use these explicit generic annotations if you don’t want to – they are shown here only for clarity. In most cases, simple `as const` + inference is enough.

---

## Using `ApiClient`

```ts
import { ApiClient } from "@tahanabavi/typefetch";
import { contracts } from "./contracts";

const client = new ApiClient(
  {
    baseUrl: "https://api.example.com",
    tokenProvider: () => "dynamic-token", // or undefined for public endpoints
    useMockData: false,
  },
  contracts
);

client.init();

const api = client.modules;

const user = await api.user.getUser({ path: { id: "123" } });
const created = await api.user.createUser({ body: { name: "Alice" } });
```

- `client.init()` builds the typed `modules` API using your contracts.
- `api.user.getUser` and `api.user.createUser` are fully typed from the Zod schemas.

---

## Middlewares

Middlewares allow you to hook into the request/response lifecycle.

### Custom Middleware Example

```ts
client.use(async (ctx, next) => {
  console.log("Request to:", ctx.url);
  const res = await next();
  console.log("Response:", res.status);
  return res;
});
```

### Built-in Middlewares

```ts
import {
  loggingMiddleware,
  retryMiddleware,
  cacheMiddleware,
  authMiddleware,
} from "@tahanabavi/typefetch/middlewares";

client.use(loggingMiddleware, {
  logRequest: true,
  logResponse: true,
  debug: true,
});
client.use(retryMiddleware, { maxRetries: 3, delay: 100 });
client.use(cacheMiddleware, { ttl: 60000 });
client.use(authMiddleware, {
  refreshToken: async () => "refreshed-token",
});
```

- **`loggingMiddleware`** – logs requests and responses (controlled by `debug`, `logRequest`, `logResponse`).
- **`retryMiddleware`** – retries failed requests with configurable `maxRetries` and `delay`.
- **`cacheMiddleware`** – caches GET responses in-memory per URL with `ttl` (ms).
- **`authMiddleware`** – can refresh tokens and inject `Authorization` headers before the request.

---

## Mock Mode

Enable or disable mock mode globally:

```ts
client.setMockMode(true, { min: 200, max: 1000 }); // simulate network delay
// ...
client.setMockMode(false);
```

When mock mode is enabled and `endpoint.mockData` is defined, requests will return mock data instead of hitting the network. The response wrapper and response transform still apply.

---

## Response Transformation

You can apply a global transformation to all successful responses:

```ts
client.useResponseTransform((data) => {
  return {
    ...data,
    transformedAt: new Date().toISOString(),
  };
});
```

This runs after:

1. The HTTP call succeeds (`res.ok` is true)
2. Optional response wrapper has been unwrapped
3. The response has been validated with the endpoint’s Zod schema

---

## Response Wrapper Example

For APIs that wrap responses like this:

```json
{
  "success": true,
  "data": { ... },
  "timestamp": "...",
  "requestId": "..."
}
```

You can define a single wrapper schema:

```ts
import { z } from "zod";

const wrapper = (successResponse: z.ZodTypeAny) =>
  z.union([
    z.object({
      success: z.literal(true),
      data: successResponse,
      timestamp: z.string(),
      requestId: z.string(),
    }),
    z.object({
      success: z.literal(false),
      message: z.string(),
      code: z.number(),
      timestamp: z.string(),
      requestId: z.string(),
    }),
  ]);

client.setResponseWrapper(wrapper);
```

On `success: true`, `data` is passed to the endpoint’s `response` schema.  
On `success: false`, a `RichError` is thrown with normalized information.

---

## Error Handling

```ts
client.onError((err) => {
  console.error("API Error:", err.message, err.status, err.code);
});
```

Errors are normalized into `RichError` (or your custom type if you change the generic). Zod validation errors are also wrapped into a `VALIDATION_ERROR` with a readable message.

You can still handle errors per-call with `try/catch`:

```ts
try {
  const user = await api.user.getUser({ path: { id: "123" } });
} catch (err) {
  // err is RichError
}
```

---

## File Uploads (`form-data`)

For endpoints that need file upload, set `bodyType: "form-data"` and put file(s) inside `body`:

```ts
const uploadAvatarRequest = z.object({
  path: z.object({}).optional(),
  query: z.object({}).optional(),
  body: z.object({
    file: z.any(), // or z.instanceof(File) in browser
  }),
  headers: z.record(z.string()).optional(),
});

const uploadAvatarResponse = z.object({
  url: z.string(),
});

const contracts = {
  user: {
    uploadAvatar: {
      method: "POST",
      path: "/users/avatar",
      auth: true,
      bodyType: "form-data",
      request: uploadAvatarRequest,
      response: uploadAvatarResponse,
    },
  },
} as const;
```

Usage:

```ts
const file = input.files?.[0];
await api.user.uploadAvatar({
  body: { file },
});
```

The client will build a `FormData` object and let the browser set the `Content-Type` header.

---

## Notes

- Always call `client.init()` before using `client.modules`.
- Middlewares execute in **reverse registration order** (last registered runs first).
- Endpoints with `auth: true` require a valid token from `token` or `tokenProvider`.
- All responses are parsed and validated by Zod using each endpoint’s `response` schema.
- Structured `{ path, query, body, headers }` shape is the canonical model; flat request schemas are still supported for backwards compatibility.

---

## License

MIT
