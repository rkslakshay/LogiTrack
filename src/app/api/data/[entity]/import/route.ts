import { z } from "zod";
import { route } from "@/lib/api";
import { tooMany } from "@/lib/errors";
import { LIMITS } from "@/lib/rate-limit";
import { MAX_IMPORT_BYTES, runImport } from "@/server/services/imports";

const schema = z.object({
  csv: z.string().min(1, "Choose a CSV file").max(MAX_IMPORT_BYTES + 1024, "The file is too large"),
  fileName: z.string().max(255).nullish(),
  /** false = preview only (always rolled back). */
  commit: z.boolean().default(false),
  /** Only with commit: import the valid rows and skip the rest. Off by default. */
  skipInvalid: z.boolean().default(false),
});

/** Previews or imports a CSV file. Permission is checked per data type in the service. */
export const POST = route({ body: schema }, async ({ user, params, body }) => {
  const limit = LIMITS.importsPerUser().hit(user.id);
  if (!limit.allowed) throw tooMany(limit.retryAfterMs);
  return runImport(user, params.entity, body.csv, { commit: body.commit, skipInvalid: body.skipInvalid, fileName: body.fileName });
});
