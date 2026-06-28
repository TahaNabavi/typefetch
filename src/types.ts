// Import "zod" for schema-based runtime validation of request and response data
import { z } from "zod";

export type EncryptionMethod = "AES" | "DES" | "RSA" | "Base64" | "Custom";
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * DeepEncryptionMap<T>
 * --------------------
 * Recursively describes which fields should be encrypted/decrypted.
 * Supports:
 *   - Primitive fields → boolean | method
 *   - Objects → recursively typed maps
 *   - Arrays → mapping applies to element type (U)
 *   - Array-map override (optional but supported)
 */
export type DeepEncryptionMap =
  | boolean
  | EncryptionMethod
  | {
      [key: string]: DeepEncryptionMap;
    }
  | DeepEncryptionMap[];

/**
 * EncryptionConfig
 * ================
 * Defines the encryption/decryption strategy for an endpoint.
 * Both request and response maps are strictly typed based on their respective Zod schemas.
 */

export type EncryptionConfig<TReq, TRes> = {
  method:
    | EncryptionMethod
    | {
        request?: EncryptionMethod;
        response?: EncryptionMethod;
      };
  /** Map of request fields to encrypt before sending to the server */
  request?: DeepEncryptionMap;
  /** Map of response fields to decrypt after receiving from the server */
  response?: DeepEncryptionMap;
};

/**
 * Base types for Zod schemas representing request and response structures.
 * These are abstract—each concrete endpoint will define its own Zod object for these.
 */
export type RequestSchema = z.ZodTypeAny;
export type ResponseSchema = z.ZodTypeAny;

/**
 * EndpointTestContext
 * ===================
 * Shared runtime state used by the API test runner.
 * It allows one endpoint test to store values that later tests can reuse.
 */
export type EndpointTestContext = {
  data: Record<string, unknown>;
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  has(key: string): boolean;
};

export type EndpointTestInputFactory<TReq> = (
  ctx: EndpointTestContext,
) => TReq | Promise<TReq>;

export type EndpointTestAssertion<TReq, TRes> = (result: {
  input: TReq;
  response: TRes;
  ctx: EndpointTestContext;
}) => void | Promise<void>;

export type EndpointTestCase<TReq, TRes> = {
  /** Human-readable name shown in the generated report. */
  name?: string;
  /** Static input or a factory that can read/write shared test context. */
  input?: TReq | EndpointTestInputFactory<TReq>;
  /** Skip this specific case. A string is used as the skip reason. */
  skip?: boolean | string;
  /** Expected HTTP status. Defaults to any successful client response. */
  expectStatus?: number | number[];
  /** Optional user-defined assertion after a successful response. */
  expect?: EndpointTestAssertion<TReq, TRes>;
  /** Per-case timeout in milliseconds. */
  timeout?: number;
  /** Tags used by the runner for include/exclude filtering. */
  tags?: string[];
};

export type EndpointTestConfig<TReq, TRes> = {
  /** Disable all generated/manual tests for this endpoint. */
  enabled?: boolean;
  /** Tags used by the runner for include/exclude filtering. */
  tags?: string[];
  /** Mark endpoints such as DELETE/reset/payment as unsafe for default runs. */
  destructive?: boolean;
  /** Default input used when cases are not provided. */
  input?: TReq | EndpointTestInputFactory<TReq>;
  /** One or more test cases for this endpoint. */
  cases?: Array<EndpointTestCase<TReq, TRes>>;
  /** Runs before the endpoint cases. */
  setup?: (ctx: EndpointTestContext) => void | Promise<void>;
  /** Runs after the endpoint cases. */
  teardown?: (ctx: EndpointTestContext) => void | Promise<void>;
};

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
  method: Method;

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
   * Field-level encryption configuration.
   * Allows selecting specific fields in request/response to be encrypted/decrypted.
   */
  encryption?: EncryptionConfig<z.infer<TReq>, z.infer<TRes>>;

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

  /**
   * Optional contract-driven tests used by the TypeFetch test runner.
   */
  test?: EndpointTestConfig<z.infer<TReq>, z.infer<TRes>>;
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
 * Convenience alias that pins both generic types
 * to `z.ZodTypeAny`, simplifying the contract declarations.
 */
export type EndpointDefZ = EndpointDef<RequestSchema, ResponseSchema>;

/**
 * Context passed to all middleware functions.
 * Contains the current request URL, initialization object,
 * and the specific endpoint definition for metadata access.
 */
export type RequestParts = {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers: Record<string, string>;
  isStructured: boolean;
  rawInput?: unknown;
};

export interface MiddlewareContext<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema = ResponseSchema,
> {
  url: string;
  init: RequestInit;
  endpoint: EndpointDef<TReq, TRes>;
  request?: RequestParts;
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
export type Middleware<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema = ResponseSchema,
  Options = any,
> = (
  ctx: MiddlewareContext<TReq, TRes>,
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
