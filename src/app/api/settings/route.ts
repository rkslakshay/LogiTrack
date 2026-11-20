import { route } from "@/lib/api";
import { settingsSchema } from "@/lib/validation";
import { getSettings, updateSettings } from "@/server/services/settings";

export const GET = route({}, () => getSettings());
export const PUT = route({ permission: "settings:manage", body: settingsSchema }, ({ user, body }) => updateSettings(user, body));
