import { z } from "zod";

export const makeRequestSchema = <
  TPath extends z.ZodRawShape = {},
  TQuery extends z.ZodRawShape = {},
  TBody extends z.ZodTypeAny = z.ZodUndefined,
>() => (
  defs: {
    path?: z.ZodObject<TPath>;
    query?: z.ZodObject<TQuery>;
    body?: TBody;
    headers?: z.ZodTypeAny;
  }
) =>
  z.object({
    path: (defs.path ?? z.object({}))?.optional(),
    query: (defs.query ?? z.object({}))?.optional(),
    body: (defs.body ?? z.undefined()) as TBody | z.ZodUndefined,
    headers: (defs.headers ?? z.record(z.string()).optional()) as any,
  });
