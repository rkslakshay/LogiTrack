import { parseListQuery, route } from "@/lib/api";
import { activityFacets, listActivity } from "@/server/services/activity";

export const GET = route({ permission: "activity:read" }, async ({ query }) => {
  const [list, facets] = await Promise.all([
    listActivity(parseListQuery(query, { pageSize: 20 }), {
      entityType: query.get("entityType"),
      action: query.get("action"),
      userId: query.get("userId"),
    }),
    activityFacets(),
  ]);
  return { ...list, facets };
});
