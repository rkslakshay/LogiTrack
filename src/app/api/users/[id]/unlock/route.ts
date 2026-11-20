import { route } from "@/lib/api";
import { unlockAccount } from "@/server/services/account";

export const POST = route({ permission: "users:manage" }, ({ user, params }) => unlockAccount(user, params.id));
