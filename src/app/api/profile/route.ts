import { route } from "@/lib/api";
import { profileSchema } from "@/lib/validation";
import { updateProfile } from "@/server/services/users";

export const PUT = route({ body: profileSchema }, ({ user, body }) => updateProfile(user, body));
