import { route } from "@/lib/api";
import { demoStatus } from "@/server/demo";

export const GET = route({}, () => demoStatus());
