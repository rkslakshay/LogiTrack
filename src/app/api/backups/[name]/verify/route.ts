import { route } from "@/lib/api";
import { verifyBackup } from "@/server/services/backup";

/** Re-checks a backup: SQLite integrity, foreign keys, migrations and checksum. */
export const POST = route({ permission: "system:backup" }, async ({ params }) => verifyBackup(params.name));
