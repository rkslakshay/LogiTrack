import { prisma } from "@/lib/db";
import { DEFAULT_SETTINGS, type SettingKey } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import { logActivity } from "./activity";

export interface AppSettings {
  companyName: string;
  simulationSpeed: number;
  averageSpeedKmh: number;
  simulationAutoComplete: boolean;
  maintenanceReminderDays: number;
  maintenanceReminderKm: number;
  complianceReminderDays: number;
}

let cache: { at: number; value: AppSettings } | null = null;
const CACHE_MS = 3000;

function parse(raw: Record<SettingKey, string>): AppSettings {
  return {
    companyName: raw.companyName,
    simulationSpeed: Number(raw.simulationSpeed) || 10,
    averageSpeedKmh: Number(raw.averageSpeedKmh) || 40,
    simulationAutoComplete: raw.simulationAutoComplete !== "false",
    maintenanceReminderDays: Number(raw.maintenanceReminderDays) || 7,
    maintenanceReminderKm: Number(raw.maintenanceReminderKm) || 500,
    complianceReminderDays: Number(raw.complianceReminderDays) || 30,
  };
}

/** Stored settings merged over defaults (briefly cached; the simulator reads this every tick). */
export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await prisma.setting.findMany();
  const merged: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = r.value;
  const value = parse(merged as Record<SettingKey, string>);
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(actor: SessionUser, input: AppSettings): Promise<AppSettings> {
  const entries = Object.entries(input) as [SettingKey, string | number | boolean][];
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx.setting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
    }
    await logActivity(tx, actor, "UPDATE", "Setting", null, "Updated system settings");
  });
  cache = null;
  return getSettings();
}

export function clearSettingsCache() {
  cache = null;
}
