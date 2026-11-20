import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * A real screenshot of the running application, shown inside a simple browser frame.
 * The images are captured from the live app by `npm run screenshots`.
 */
export function BrowserFrame({ src, alt, priority, className, path }: { src: string; alt: string; priority?: boolean; className?: string; path: string }) {
  return (
    <figure className={cn("overflow-hidden rounded-lg border border-navy-700/60 bg-navy-900 shadow-[0_24px_60px_-20px_rgb(7_18_38/0.55)]", className)}>
      <div className="flex items-center gap-2 border-b border-navy-700/60 px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2 rounded-full bg-navy-700" />
          <span className="size-2 rounded-full bg-navy-700" />
          <span className="size-2 rounded-full bg-navy-700" />
        </span>
        <span className="mx-auto truncate rounded-sm bg-navy-800 px-3 py-0.5 font-mono text-[10px] text-navy-300">logitrack.local{path}</span>
      </div>
      <Image src={src} alt={alt} width={1440} height={900} priority={priority} sizes="(min-width: 1024px) 60vw, 94vw" className="block h-auto w-full" />
    </figure>
  );
}
