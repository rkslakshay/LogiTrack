import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Truck } from "lucide-react";
import { safeRedirectPath } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth-server";
import { homeFor } from "@/lib/permissions";
import { isDemoMode } from "@/server/demo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; notice?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  const { next, notice } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2.5" aria-label="LogiTrack home">
            <span className="grid size-8 place-items-center rounded-md bg-primary text-white">
              <Truck className="size-[18px]" aria-hidden />
            </span>
            <span className="text-[17px] font-semibold tracking-tight text-ink">LogiTrack</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-primary">
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to overview
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:py-12">
        {/* Only same-site relative paths are honoured as a post-login destination. */}
        <LoginForm next={safeRedirectPath(next)} demo={isDemoMode()} notice={notice === "password-reset" || notice === "restored" ? notice : null} />
      </main>
      <footer className="px-5 py-5 text-center text-xs text-ink-3">
        {isDemoMode() ? "Demo environment · sample data · vehicle movement is simulated" : "LogiTrack"}
      </footer>
    </div>
  );
}
