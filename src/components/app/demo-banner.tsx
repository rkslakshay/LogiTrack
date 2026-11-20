"use client";

import * as React from "react";
import { Compass, FlaskConical, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useCan, useDemo, useSocketEvent } from "./providers";
import { useTour } from "./tour";

/**
 * Slim strip at the top of every page in demo mode. It says plainly that the
 * data is sample data, and offers the tour and (for staff) a one-click reset.
 */
export function DemoBanner() {
  const demo = useDemo();
  const can = useCan();
  const tour = useTour();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // "N minutes ago" depends on the clock, so it is only rendered in the browser:
  // the server and the client would otherwise disagree by a second and break hydration.
  const mounted = React.useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  // Whoever resets, every open page reloads onto the fresh dataset.
  useSocketEvent("demo:reset", () => window.location.reload());

  if (!demo.enabled) return null;

  const reset = async () => {
    setBusy(true);
    try {
      await api.post("/api/demo/reset");
      toast.success("Demo data reset");
      // The socket event reloads the page; this is the fallback if the socket is not connected.
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-warning/20 bg-warning-soft px-3 py-1.5 text-xs text-ink-2 sm:px-5" role="note" aria-label="Demo environment">
      <span className="flex items-center gap-1.5 font-medium text-warning">
        <FlaskConical className="size-3.5" aria-hidden />
        Demo environment
      </span>
      <span>
        You are working with sample data{mounted && demo.seededAt ? ` generated ${timeAgo(demo.seededAt)}` : ""}. Vehicle movement is simulated.
      </span>
      <span className="ml-auto flex items-center gap-3">
        {!tour.active && (
          <button type="button" onClick={tour.start} className="flex items-center gap-1 font-medium text-primary hover:underline">
            <Compass className="size-3.5" aria-hidden />
            Take the tour
          </button>
        )}
        {can("demo:reset") && (
          <button type="button" onClick={() => setConfirming(true)} className="flex items-center gap-1 font-medium text-primary hover:underline">
            <RotateCcw className="size-3.5" aria-hidden />
            Reset demo data
          </button>
        )}
      </span>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !busy && setConfirming(open)}
        title="Reset the demo data?"
        description="Everything is rebuilt from the sample dataset: vehicles, drivers, deliveries, fuel, maintenance, notifications and the activity log. Changes made during this demo are discarded, and the simulated trips start again. Demo logins keep working."
        confirmLabel="Reset demo data"
        tone="primary"
        loading={busy}
        onConfirm={reset}
      />
    </div>
  );
}
