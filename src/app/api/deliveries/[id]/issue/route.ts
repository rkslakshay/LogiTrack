import { route } from "@/lib/api";
import { issueSchema } from "@/lib/validation";
import { reportIssue } from "@/server/services/deliveries";

export const POST = route({ permission: ["deliveries:status", "deliveries:own"], body: issueSchema }, ({ user, params, body }) =>
  reportIssue(user, params.id, body.note),
);
