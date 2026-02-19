// Import "zod" for schema-based runtime validation of request and response data
import { z } from "zod";

/**
 * Base types for Zod schemas representing request and response structures.
 * These are abstract—each concrete endpoint will define its own Zod object for these.
 */
export type RequestSchema = z.ZodTypeAny;
export type ResponseSchema = z.ZodTypeAny;

/**
 * EndpointDef
 * ============
 * Defines the structure of a **single API endpoint**, including:
 * - HTTP method and path
 * - request/response validation schemas
 * - optional authentication requirement
 * - optional mock or static mock data
 * - optional custom headers and body format
 */
export type EndpointDef<
  TReq extends RequestSchema,
  TRes extends ResponseSchema,
> = {
  /** HTTP method used by this endpoint */
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

  /** URL path for this endpoint, e.g. "/users/:id" */
  path: string;

  /** Whether this endpoint requires an Authorization token */
  auth?: boolean;

  /** Zod schema describing the expected request structure */
  request: TReq; // Typically { path?, query?, body? }

  /** Zod schema describing the expected response structure */
  response: TRes;

  /**
   * Mock data support — enables quick testing or local dev mode:
   * - Either a function returning a mock response object
   * - Or a static mock response object
   */
  mockData?: (() => z.infer<TRes>) | z.infer<TRes>;

  /**
   * Optional custom headers. Can be:
   * - A fixed record of header key/values
   * - A function returning headers derived from the input data
   */
  headers?:
    | Record<string, string>
    | ((input: z.infer<TReq>) => Record<string, string>);

  /**
   * Defines how the request body should be sent:
   * - `"json"` (default): serialized as JSON
   * - `"form-data"`: multipart form
   */
  bodyType?: "json" | "form-data";
};

/**
 * Contracts
 * =========
 * A collection of modules, each containing one or more endpoints.
 * This defines a **hierarchical API contract**.
 *
 * For example:
 * {
 *   users: {
 *     getUser: EndpointDef(...),
 *     updateUser: EndpointDef(...)
 *   },
 *   posts: {
 *     createPost: EndpointDef(...),
 *     listPosts: EndpointDef(...)
 *   }
 * }
 */
export type Contracts = {
  [ModuleName: string]: {
    [EndpointName: string]: EndpointDef<RequestSchema, ResponseSchema>;
  };
};

/**
 * Context passed to all middleware functions.
 * Contains the current request URL and initialization object
 * (headers, method, body, etc.).
 */
export interface MiddlewareContext {
  url: string;
  init: RequestInit;
}

/**
 * The `next()` function type signature used inside middleware.
 * When called, it executes the next function in the chain
 * or finally performs the fetch request.
 */
export type MiddlewareNext = () => Promise<Response>;

/**
 * Middleware
 * ==========
 * Defines the standard structure for a request middleware.
 * Middlewares can intercept, modify, or even short-circuit requests.
 *
 * @example Logging Example:
 * const logMiddleware: Middleware = async (ctx, next) => {
 *   console.log("Request:", ctx.url);
 *   const res = await next();
 *   console.log("Response:", res.status);
 *   return res;
 * };
 */
export type Middleware<Options = any> = (
  ctx: MiddlewareContext,
  next: MiddlewareNext,
  options?: Options,
) => Promise<Response>;

/**
 * ErrorLike
 * =========
 * Represents the normalized error shape used across the client.
 * Provides consistency for error handling modules such as RichError.
 */
export type ErrorLike = {
  message: string; // Human-readable error message
  status?: number; // HTTP status code (optional)
  code?: string; // Application-level error code (optional)
  [key: string]: any; // Any additional arbitrary fields
};

/**
 * Convenience alias that pins both generic types
 * to `z.ZodTypeAny`, simplifying the contract declarations.
 */
export type EndpointDefZ = EndpointDef<RequestSchema, ResponseSchema>;

/**
 * RequestOptions
 * ==============
 * Per-request options passed to the client execution:
 * - Optional AbortSignal (for cancellation)
 * - Optional timeout (in milliseconds)
 */
export type RequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
};

/**
 * EndpointMethods
 * ================
 * Automatically generated method signatures for all endpoints
 * within a module, based on the Zod contract definitions.
 *
 * Each endpoint method:
 * - Validates input against its request schema
 * - Returns a Promise of the parsed and validated response type
 */
export type EndpointMethods<M extends Record<string, EndpointDefZ>> = {
  [K in keyof M]: (
    input: z.infer<M[K]["request"]>, // Auto‑derived input type from Zod schema
    options?: RequestOptions, // Optional timeout/cancel options
  ) => Promise<z.infer<M[K]["response"]>>; // Parsed, validated output type
};

/**
 * TokenProvider
 * =============
 * Specifies the contract for a function that supplies authentication tokens.
 * Can be synchronous or async, e.g. fetching from localStorage or refreshing with an API.
 */
export type TokenProvider = () => string | Promise<string>;
