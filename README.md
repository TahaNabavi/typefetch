# TypeFetch

TypeFetch is a type-safe client for working with APIs, built with TypeScript and Zod. This project allows you to define API contracts and safely use types, while also supporting middlewares, error handling, response transformation, mock data, and response wrappers.

---

## Features

- Fully type-safe using TypeScript and Zod
- Define contracts for modules and endpoints
- Support for middlewares to add custom behavior before or after requests
- Error handling with the `RichError` class
- Ability to transform responses using a response transformer
- Authentication support via token
- Mock data support for development and testing
- Response wrapper for consistent API response formats

---

## Installation

```bash
npm install @tahanabavi/typefetch
# or
yarn add @tahanabavi/typefetch
```

---

## What's New in v1.1.0

### 🎯 Mock Data Support

- Add mock data to endpoints for development and testing
- Configurable random delays to simulate network latency
- Support for both static data and dynamic functions
- Runtime toggle between mock and real API modes

### 🔄 Response Wrapper

- Consistent API response format handling
- Automatic validation of wrapped responses
- Support for success/error response patterns
- Seamless integration with existing contracts

### 🚀 Enhanced Error Handling

- Better Zod error wrapping and reporting
- Improved type safety for response wrappers

---

## Defining Contracts

Contracts are defined using the `Contracts` and `EndpointDef` types.

```ts
import { z } from "zod";

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/user/:id",
      auth: true,
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
      // Optional mock data
      mockData: { id: "1", name: "John Doe" },
    },
    createUser: {
      method: "POST",
      path: "/user",
      request: z.object({ name: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
      // Dynamic mock data function
      mockData: () => ({ id: Math.random().toString(), name: "Dynamic User" }),
    },
  },
} as const;
```

---

## Using `ApiClient`

```ts
import { ApiClient, RichError } from "typefetch";

const client = new ApiClient(
  {
    baseUrl: "https://api.example.com",
    token: "your-auth-token",
    useMockData: true,
    mockDelay: { min: 100, max: 1000 },
  },
  contracts
);

client.init();

const { modules: api } = client;

const user = await api.user.getUser({ id: "123" });
const newUser = await api.user.createUser({ name: "Taha" });
```

---

## Error Handling

All errors are provided via the `RichError` class. You can define a custom error handler:

```ts
client.onError((error: RichError) => {
  console.error("API Error:", error.message, error.status, error.code);
});
```

---

## Middlewares

You can add custom behavior before or after requests. Middlewares work similarly to Express:

```ts
client.use(
  async (ctx: MiddlewareContext, next: MiddlewareNext, options?: any) => {
    console.log("Request URL:", ctx.url);
    const response = await next();
    console.log("Response status:", response.status);
    return response;
  }
);
```

### Built-in Middlewares

This project provides some built-in middlewares:

```ts
import {
  LoggingMiddleware,
  RetryMiddleware,
  AuthMiddleware,
  CacheMiddleware,
} from "typefetch/middlewares";

client.use(LoggingMiddleware);
client.use(RetryMiddleware, { maxRetries: 3, delay: 100 });
client.use(AuthMiddleware, { refreshToken: () => "your-auth-token" });
client.use(CacheMiddleware, { ttl: 60 * 1000 });
```

- `LoggingMiddleware` – Logs requests and responses
- `RetryMiddleware` – Retries failed requests
- `AuthMiddleware` – Automatically adds Authorization headers
- `CacheMiddleware` – Caches responses to reduce repeated requests

---

## Response Transformation

You can transform the response format before returning it:

```ts
client.useResponseTransform((data) => {
  return { ...data, fetchedAt: new Date() };
});
```

---

## Mock Data Features

Static Mock Data:

```ts
mockData: { id: "1", name: "Static User" }
```

Dynamic Mock Data:

```ts
mockData: () => ({ id: Math.random().toString(), name: `User-${Date.now()}` });
```

Runtime Control:

```ts
client.setMockMode(true, { min: 100, max: 2000 });
client.setMockMode(false);
```

---

## Response Wrapper Features

```ts
const apiResponseWrapper = (successResponse: z.ZodTypeAny) =>
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

client.setResponseWrapper(apiResponseWrapper);
```

---

## Important Notes

- Always call `client.init()` before using endpoints.
- Types are automatically inferred from Zod, making inputs and outputs type-safe.
- Middleware execution order: first added middleware runs last, last added middleware runs first.
- Mock data is used only when `useMockData` is true and mock data is defined.
- Response wrapper automatically handles success/error patterns.

---

## Full Example

```ts
import { z } from "zod";
import { ApiClient, RichError } from "typefetch";
import { LoggingMiddleware, RetryMiddleware } from "typefetch/middlewares";

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      auth: true,
      request: z.object({ id: z.string() }),
      response: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      }),
      mockData: { id: "1", name: "John Doe", email: "john@example.com" },
    },
  },
} as const;

const apiResponseWrapper = (successResponse: z.ZodTypeAny) =>
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

const client = new ApiClient(
  {
    baseUrl: "https://api.example.com",
    token: "abc123",
    useMockData: process.env.NODE_ENV === "development",
  },
  contracts
);

client.init();
client.setResponseWrapper(apiResponseWrapper);
client.use(LoggingMiddleware);
client.use(RetryMiddleware, { maxRetries: 2 });

client.onError((err: RichError) => {
  console.error("Error:", err.message);
});

const { modules: api } = client;

(async () => {
  const user = await api.user.getUser({ id: "1" });
  console.log(user);
})();
```

---

## License

MIT
