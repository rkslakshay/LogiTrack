import { route } from "@/lib/api";
import { checkLiveDatabase } from "@/server/services/backup";

/** Integrity check of the live database (PRAGMA integrity_check and foreign_key_check). */
export const POST = route({ permission: "system:backup" }, async () => checkLiveDatabase());
