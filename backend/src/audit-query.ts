import { z } from "zod";
import { parse } from "./contracts";

const fields = {
  search: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  action: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  entityType: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  actorId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
};
const ordered = (v: { from?: string; to?: string }) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to);
export const auditFiltersDto = z.object(fields).strict().refine(ordered, { message: "End date must follow start date.", path: ["to"] });
const auditPageDto = z.object({ ...fields,
  cursor: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine(ordered, { message: "End date must follow start date.", path: ["to"] });
export function auditPage(query: unknown) {
  const { cursor, limit, ...filters } = parse(auditPageDto, query);
  return { filters, page: { cursor, limit } };
}
export function auditFilter(orgId: string, filters: z.infer<typeof auditFiltersDto>) {
  const { from, to, search, ...exact } = filters;
  const escaped = search?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { orgId, ...exact, ...(escaped ? { $or: ["action", "entityType", "requestId"].map(field => ({ [field]: { $regex: escaped, $options: "i" } })) } : {}), ...(from || to ? { occurredAt: {
    ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}),
  } } : {}) };
}
