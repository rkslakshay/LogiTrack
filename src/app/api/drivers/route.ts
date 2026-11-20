import { parseListQuery, route } from "@/lib/api";
import { driverSchema } from "@/lib/validation";
import { createDriver, listDrivers } from "@/server/services/drivers";

export const GET = route({ permission: "drivers:read" }, ({ query }) =>
  listDrivers(parseListQuery(query), { status: query.get("status"), assigned: query.get("assigned") }),
);

export const POST = route({ permission: "drivers:write", body: driverSchema }, ({ user, body }) => createDriver(user, body));
