// types.ts
import { z } from "zod";

/**
 * Generic request schema:
 *
 * request: z.object({
 *   path: z.object({ ... }).optional(),
 *   query: z.object({ ... }).optional(),
 *   body: z.object({ ... }).optional(),
 * })
 */
export type RequestSchema = z.ZodTypeAny;
export type ResponseSchema = z.ZodTypeAny;

export type EndpointDef<
  TReq extends RequestSchema,
  TRes extends ResponseSchema
> = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string; // e.g. "/users/:id"
  auth?: boolean;
  request: TReq; // expected shape: { path?, query?, body? }
  response: TRes;
  mockData?: (() => z.infer<TRes>) | z.infer<TRes>;
};

export type Contracts = {
  [ModuleName: string]: {
    [EndpointName: string]: EndpointDef<RequestSchema, ResponseSchema>;
  };
};

export interface MiddlewareContext {
  url: string;
  init: RequestInit;
}

export type MiddlewareNext = () => Promise<Response>;

export type Middleware<Options = any> = (
  ctx: MiddlewareContext,
  next: MiddlewareNext,
  options?: Options
) => Promise<Response>;

export type ErrorLike = {
  message: string;
  status?: number;
  code?: string;
  [key: string]: any;
};

export type EndpointDefZ = EndpointDef<RequestSchema, ResponseSchema>;

/**
 * For each endpoint we expose a method:
 *   (input: z.infer<Endpoint["request"]>) => Promise<z.infer<Endpoint["response"]>>
 *
 * So VSCode will show you:
 *   { path?: { ... }, query?: { ... }, body?: { ... } }
 */
export type EndpointMethods<M extends Record<string, EndpointDefZ>> = {
  [K in keyof M]: (
    input: z.infer<M[K]["request"]>
  ) => Promise<z.infer<M[K]["response"]>>;
};

export type TokenProvider = () => string | Promise<string>;
