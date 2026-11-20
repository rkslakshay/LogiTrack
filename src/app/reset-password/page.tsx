import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Reset password", referrer: "no-referrer" };

/**
 * Public page for one-time reset links. The token is in the URL fragment
 * (#token=…), which browsers never send to the server or to other sites.
 */
export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2.5" aria-label="LogiTrack home">
            <span className="grid size-8 place-items-center rounded-md bg-primary text-white">
              <Truck className="size-[18px]" aria-hidden />
            </span>
            <span className="text-[17px] font-semibold tracking-tight text-ink">LogiTrack</span>
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-sm flex-1 px-5 py-12">
        <ResetPasswordForm />
      </main>
    </div>
  );
}
