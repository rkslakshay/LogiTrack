"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { canAny, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUser } from "./providers";

/**
 * Guided product tour. It is deliberately not a modal: the card floats at the
 * bottom of the screen while the real page stays fully usable, and each step
 * simply takes the visitor to the next module and says what to look at.
 */

interface TourStep {
  href: string;
  permissions: Permission[];
  title: string;
  body: string;
  /** Concrete things to try on this page. */
  tryThis: string[];
}

const STEPS: TourStep[] = [
  {
    href: "/dashboard", permissions: ["dashboard:view"], title: "Main dashboard",
    body: "The control room. Every number and chart here is calculated from the database when the page loads: fleet status, delivery performance, costs and what needs attention.",
    tryThis: ["Change the date range at the top right", "Check “Deliveries at risk” for trips likely to run late"],
  },
  {
    href: "/vehicles", permissions: ["vehicles:read"], title: "Fleet management",
    body: "Every vehicle with its status, assigned driver, odometer and document expiry. A vehicle that is on a delivery or under maintenance cannot be given new work.",
    tryThis: ["Search or filter by type and status", "Open a vehicle to see its deliveries, fuel and service history"],
  },
  {
    href: "/drivers", permissions: ["drivers:read"], title: "Driver management",
    body: "Driver profiles with licence validity, their regular vehicle and a performance score built from their own delivery record.",
    tryThis: ["Sort by licence expiry to spot renewals", "Open a profile to see delivery history"],
  },
  {
    href: "/deliveries", permissions: ["deliveries:read"], title: "Delivery operations",
    body: "The delivery workflow: Pending → Assigned → Picked Up → In Transit → Delivered, with delays, failures and cancellations handled along the way. Each delivery keeps a full event history.",
    tryThis: ["Use the Active tab and look at the Risk column", "Open a delivery, then Update status or Assign"],
  },
  {
    href: "/tracking", permissions: ["tracking:view"], title: "Live tracking",
    body: "Vehicles move on an OpenStreetMap map in real time over a websocket. Positions come from LogiTrack's own GPS simulator, which follows each delivery's route.",
    tryThis: ["Select a moving vehicle to see its driver, destination and progress", "Pause and resume the simulation"],
  },
  {
    href: "/routes", permissions: ["routes:read"], title: "Route planning",
    body: "Estimate a single trip, or pick several pending deliveries and let the optimiser order the stops (nearest neighbour, then 2-opt) while keeping each pickup ahead of its drop-off.",
    tryThis: ["Tick two or three deliveries and press Optimise route", "Compare the three route options"],
  },
  {
    href: "/analytics", permissions: ["analytics:view"], title: "Analytics and intelligence",
    body: "Period-over-period comparison with plain-language explanations, plus fleet utilisation, fuel efficiency, maintenance recommendations and driver productivity, all from real records.",
    tryThis: ["Switch the comparison between previous period and last year", "Open the Fleet and Fuel tabs for flagged vehicles"],
  },
  {
    href: "/import-export", permissions: ["vehicles:write", "drivers:write", "deliveries:write", "fuel:write", "maintenance:write"], title: "Import and export",
    body: "Bring records in from a spreadsheet. Check file validates every row with the same rules as the forms and saves nothing; the import itself is all-or-nothing unless you choose to skip rows with problems.",
    tryThis: ["Download a template, add a row, and press Check file", "Export your records in the same format"],
  },
  {
    href: "/diagnostics", permissions: ["system:diagnostics"], title: "Operations",
    body: "For the Super Admin: live health of the server, database, websockets, GPS simulator and background jobs, plus Backup & Restore for verified database backups.",
    tryThis: ["Look at Background jobs and Recent warnings", "Open Backup & Restore in the menu and create a backup"],
  },
  {
    href: "/my-deliveries", permissions: ["deliveries:own"], title: "My deliveries",
    body: "The driver's view: only the deliveries assigned to this driver, with pickup, destination, customer contact and instructions.",
    tryThis: ["Update the status of an active delivery", "Report an issue to dispatch"],
  },
  {
    href: "/my-performance", permissions: ["performance:own"], title: "My performance",
    body: "A driver sees their own score, on-time rate and history, with the scoring formula explained. Other drivers' numbers are not accessible.",
    tryThis: ["Change the period", "Read how the score is calculated"],
  },
];

const DONE_KEY = "logitrack:tour-done";
const CHANGE_EVENT = "logitrack:tour-change";

// The "tour finished" flag lives in localStorage; useSyncExternalStore keeps React in step with it.
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}
const readDone = () => {
  try {
    return window.localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true;
  }
};
function markDone() {
  try {
    window.localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* private mode: the tour simply offers itself again next time */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

interface TourApi {
  active: boolean;
  /** True until the visitor has finished or skipped the tour once. */
  offered: boolean;
  step: TourStep | null;
  index: number;
  count: number;
  start: () => void;
  next: () => void;
  back: () => void;
  stop: () => void;
}
const TourContext = React.createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const ctx = React.useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside <TourProvider>");
  return ctx;
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const user = useUser();
  const router = useRouter();
  const steps = React.useMemo(() => STEPS.filter((s) => canAny(user.role, s.permissions)), [user.role]);
  const [index, setIndex] = React.useState<number | null>(null);
  const done = React.useSyncExternalStore(subscribe, readDone, () => true);

  const go = React.useCallback(
    (i: number) => {
      setIndex(i);
      router.push(steps[i].href);
    },
    [router, steps],
  );
  const stop = React.useCallback(() => {
    setIndex(null);
    markDone();
  }, []);

  const value = React.useMemo<TourApi>(
    () => ({
      active: index !== null,
      offered: !done && steps.length > 0,
      step: index === null ? null : steps[index],
      index: index ?? 0,
      count: steps.length,
      start: () => steps.length > 0 && go(0),
      next: () => (index !== null && index < steps.length - 1 ? go(index + 1) : stop()),
      back: () => index !== null && index > 0 && go(index - 1),
      stop,
    }),
    [index, steps, done, go, stop],
  );
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

/** Floating step card. Rendered once, by the shell. */
export function TourCard() {
  const tour = useTour();
  if (!tour.active || !tour.step) return null;
  const { step } = tour;
  const last = tour.index === tour.count - 1;

  return (
    <div
      role="dialog"
      aria-label={`Product tour, step ${tour.index + 1} of ${tour.count}: ${step.title}`}
      className="fixed inset-x-0 bottom-3 z-40 mx-auto w-[min(94vw,480px)] animate-fade-in rounded-lg border border-navy-700 bg-navy-900 p-4 text-white shadow-pop lg:left-60"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-300">
          <Compass className="size-3.5" aria-hidden />
          Product tour · {tour.index + 1} of {tour.count}
        </p>
        <button type="button" onClick={tour.stop} className="-mr-1 -mt-1 rounded-md p-1 text-navy-300 hover:bg-navy-800 hover:text-white" aria-label="Skip tour">
          <X className="size-4" />
        </button>
      </div>
      <h2 className="mt-1.5 text-base font-semibold">{step.title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-navy-200">{step.body}</p>
      <ul className="mt-2 space-y-1 text-[13px] text-navy-200">
        {step.tryThis.map((tip) => (
          <li key={tip} className="flex gap-2">
            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" aria-hidden />
            {tip}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" aria-hidden>
          {Array.from({ length: tour.count }, (_, i) => (
            <span key={i} className={cn("h-1 rounded-full transition-all", i === tour.index ? "w-5 bg-primary" : i < tour.index ? "w-2 bg-navy-300" : "w-2 bg-navy-700")} />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={tour.stop} className="text-navy-200 hover:bg-navy-800 hover:text-white">
            Skip tour
          </Button>
          {tour.index > 0 && (
            <Button variant="ghost" size="icon" onClick={tour.back} aria-label="Previous step" className="text-navy-200 hover:bg-navy-800 hover:text-white">
              <ArrowLeft />
            </Button>
          )}
          <Button size="sm" onClick={tour.next}>
            {last ? "Finish" : "Next"}
            {!last && <ArrowRight />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Invitation shown in the sidebar until the tour has been taken or dismissed. */
export function TourPrompt() {
  const tour = useTour();
  if (!tour.offered || tour.active) return null;
  return (
    <div className="mx-2.5 mb-3 rounded-md border border-navy-700 bg-navy-800/70 p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-white">
        <Compass className="size-4 text-navy-200" aria-hidden />
        New to LogiTrack?
      </p>
      <p className="mt-1 text-xs text-navy-300">Take a two-minute tour of the main modules.</p>
      <div className="mt-2.5 flex gap-1.5">
        <Button size="sm" onClick={tour.start}>
          Start tour
        </Button>
        <Button size="sm" variant="ghost" onClick={tour.stop} className="text-navy-200 hover:bg-navy-800 hover:text-white">
          No thanks
        </Button>
      </div>
    </div>
  );
}
