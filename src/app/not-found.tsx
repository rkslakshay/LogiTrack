import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
        <Compass className="size-6" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">The page you are looking for does not exist or has been moved.</p>
      <Button asChild className="mt-5">
        <Link href="/">Back to LogiTrack</Link>
      </Button>
    </div>
  );
}
