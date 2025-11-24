# TypeFetch

TypeFetch is a strongly-typed HTTP client built on TypeScript and Zod.

You define your API once using Zod schemas, and TypeFetch generates a fully type-safe client with:

- End-to-end type safety
- Automatic URL handling (path, query, body)
- Middleware pipeline (logging, retry, cache, auth)
- Mock mode for development
- Dynamic token providers
- Response wrappers for consistent API envelopes
- Unified error system (RichError)

## Installation

npm install @tahanabavi/typefetch

# or

yarn add @tahanabavi/typefetch

## Key Features

1. Type-Safe API Client  
   Define your API with Zod schemas and get full type safety for request and response types.

2. Structured Request Support  
   Each request may contain:

   - path: URL parameters (fills /users/:id)
   - query: URL query string ?page=1&limit=10
   - body: JSON payload for POST/PUT/PATCH

   The client automatically builds URLs and bodies correctly.

3. Backward Compatibility  
   If your request schema is flat (z.object({ name: z.string() })), TypeFetch automatically treats it as a simple body payload—no breaking changes.

4. Middlewares  
   Middlewares allow modifying requests and responses.
   Built-in middlewares include:

   - loggingMiddleware
   - retryMiddleware
   - authMiddleware
   - cacheMiddleware

5. Token Provider System  
   Provide tokens dynamically using:

   - token: static auth token
   - tokenProvider: function or async function returning a token

6. Mock Mode  
   Provides mock responses based on endpoint.mockData, with configurable fake delays.

7. Response Wrapper  
   For APIs that wrap responses:

   ```
   {
     "success": true,
     "data": {...},
     "timestamp": "...",
     "requestId": "..."
   }
   ```

   TypeFetch unwraps the response automatically.

## Defining API Contracts

Example contract definition:

```
import { z } from "zod";

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
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
      }),
      mockData: { id: "1", name: "John Doe" }
    },

    createUser: {
      method: "POST",
      path: "/users",
      auth: true,
      request: z.object({
        path: z.object({}).optional(),
        query: z.object({}).optional(),
        body: z.object({ name: z.string() }).optional(),
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
      }),
      mockData: () => ({
        id: Math.random().toString(36).slice(2),
        name: "Mock User",
      }),
    }
  }
};
```

## Using ApiClient

```
import { ApiClient } from "@tahanabavi/typefetch";

const client = new ApiClient(
  {
    baseUrl: "https://api.example.com",
    tokenProvider: () => "dynamic-token",
    useMockData: false
  },
  contracts
);

client.init();

const api = client.modules;

const user = await api.user.getUser({ path: { id: "123" } });
const created = await api.user.createUser({ body: { name: "Alice" } });
```

## Middlewares

Example custom middleware:

```
client.use(async (ctx, next) => {
  console.log("Request to:", ctx.url);
  const res = await next();
  console.log("Response:", res.status);
  return res;
});
```

Built-in middlewares:

```
import {
  loggingMiddleware,
  retryMiddleware,
  cacheMiddleware,
  authMiddleware
} from "@tahanabavi/typefetch/middlewares";

  client.use(loggingMiddleware, { logRequest: true });
  client.use(retryMiddleware, { maxRetries: 3, delay: 100 });
  client.use(cacheMiddleware, { ttl: 60000 });
  client.use(authMiddleware, {
  refreshToken: async () => "refreshed-token"
});
```

## Mock Mode
```
client.setMockMode(true, { min: 200, max: 1000 });
client.setMockMode(false);
```
## Response Transformation
```
client.useResponseTransform((data) => {
  return {
    ...data,
    transformedAt: new Date().toISOString()
  };
});
```
## Response Wrapper Example
```
const wrapper = (successResponse) =>
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
## Error Handling
```
client.onError((err) => {
  console.error("API Error:", err.message, err.status, err.code);
});
```
## Notes

- Always call client.init() before using client.modules.
- Middlewares run in reverse registration order.
- Endpoints requiring auth must have a token or tokenProvider.
- All responses are validated via Zod.
- Backward-compatible request support makes migration safe.

## License

MIT
