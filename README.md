# TypeFetch

TypeFetch is a type-safe client for working with APIs, built with TypeScript and Zod. This project allows you to define API contracts and safely use types, while also supporting middlewares, error handling, and response transformation.

---

## Features

* Fully type-safe using TypeScript and Zod
* Define contracts for modules and endpoints
* Support for middlewares to add custom behavior before or after requests
* Error handling with the `RichError` class
* Ability to transform responses using a response transformer
* Authentication support via token

---

## Installation

```bash
npm install @tahanabavi/typefetch
# or
yarn add @tahanabavi/typefetch
```

---

## Defining Contracts

Contracts are defined using the `Contracts` and `EndpointDef` types

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
    },
    createUser: {
      method: "POST",
      path: "/user",
      request: z.object({ name: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
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
  },
  contracts
);

client.init();

const user = await client.user.getUser({ id: "123" });
const newUser = await client.user.createUser({ name: "Taha" });
```

---

## Error Handling

All errors are provided via the `RichError` class. You can define a custom error handler:

```ts
client.onError((error: RichError) => {
  console.error("API Error:", error.message, error.status);
});
```

---

## Middlewares

You can add custom behavior before or after requests. Middlewares work similarly to Express:

```ts
client.use(async (ctx, next, options) => {
  console.log("Request URL:", ctx.url);
  const response = await next();
  console.log("Response status:", response.status);
  return response;
});
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

* `LoggingMiddleware` – Logs requests and responses
* `RetryMiddleware` – Retries failed requests
* `AuthMiddleware` – Automatically adds Authorization headers
* `CacheMiddleware` – Caches responses to reduce repeated requests

---

## Response Transformation

You can transform the response format before returning it:

```ts
client.useResponseTransform((data) => {
  return { ...data, fetchedAt: new Date() };
});
```

---

## Important Notes

* Always call `client.init()` before using endpoints.
* Types are automatically inferred from Zod, making inputs and outputs type-safe.
* Middleware execution order: first added middleware runs last, last added middleware runs first.

---

## Full Example

```ts
import { z } from "zod";
import { ApiClient, RichError } from "typefetch";
import { LoggingMiddleware, RetryMiddleware } from "typefetch/middlewares";

const contracts = {
  post: {
    getPost: {
      method: "GET",
      path: "/posts/:id",
      auth: true,
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string(), title: z.string() }),
    },
  },
} as const;

const client = new ApiClient(
  { baseUrl: "https://api.example.com", token: "abc123" },
  contracts
);

client.init();
client.use(LoggingMiddleware);
client.use(RetryMiddleware, { maxRetries: 2 });

client.onError((err: RichError) => {
  console.error("Error:", err.message);
});

(async () => {
  const post = await client.post.getPost({ id: "1" });
  console.log(post);
})();
```