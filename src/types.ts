import { z } from "zod";

export type EndpointDef<
  TReq extends z.ZodTypeAny,
  TRes extends z.ZodTypeAny
> = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  auth?: boolean;
  request: TReq;
  response: TRes;
};

export type Contracts = {
  [ModuleName: string]: {
    [EndpointName: string]: EndpointDef<z.ZodTypeAny, z.ZodTypeAny>;
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

export type EndpointDefZ = EndpointDef<z.ZodTypeAny, z.ZodTypeAny>;

export type EndpointMethods<M extends Record<string, EndpointDefZ>> = {
  [K in keyof M]: (
    input: z.infer<M[K]["request"]>
  ) => Promise<z.infer<M[K]["response"]>>;
};
