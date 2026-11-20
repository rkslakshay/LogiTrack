import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, ArrowRight, BarChart3, Boxes, CheckCircle2, ClipboardList, Database, Fuel, Gauge, KeyRound, Layers, MapPinned, Radio, Route, ShieldCheck,
  Sparkles, TestTube2, Timer, Truck, Users, Wrench, type LucideIcon,
} from "lucide-react";
import { BrowserFrame } from "@/components/marketing/browser-frame";
import { Reveal } from "@/components/marketing/reveal";
import { getCurrentUser } from "@/lib/auth-server";
import { homeFor } from "@/lib/permissions";
import { isDemoMode } from "@/server/demo";

export const metadata: Metadata = {
  title: "LogiTrack · Fleet and logistics management platform",
  description: "Vehicles, drivers, deliveries, live tracking, route optimisation, fuel, maintenance and analytics in one platform.",
};

const CAPABILITIES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Truck, title: "Fleet and drivers", text: "Vehicles, documents, driver profiles and assignments, with availability enforced at every step." },
  { icon: ClipboardList, title: "Delivery workflow", text: "A strict status workflow from pending to delivered, with a complete event history per consignment." },
  { icon: MapPinned, title: "Live tracking", text: "Vehicles move on the map in real time over a websocket, selected, filtered and followed." },
  { icon: Route, title: "Route optimisation", text: "Multi-stop pickup-and-delivery planning with nearest-neighbour and 2-opt optimisation." },
  { icon: Fuel, title: "Fuel and maintenance", text: "Fill-to-fill mileage, cost per kilometre, service history and reminders by date and odometer." },
  { icon: BarChart3, title: "Analytics and reports", text: "Period-over-period comparison, explanations of what changed, and CSV exports." },
];

const INTELLIGENCE: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Timer, title: "Delivery risk detection", text: "Projects an arrival time for every open delivery and flags low, medium or high risk, with the reason spelled out." },
  { icon: Gauge, title: "Fleet utilisation", text: "Active, idle and downtime days per vehicle, and a plain explanation for every vehicle that is under-used." },
  { icon: Fuel, title: "Fuel efficiency", text: "Detects mileage drops, poor performers against comparable vehicles and gaps in the fuel records." },
  { icon: Wrench, title: "Maintenance recommendations", text: "Suggests the next routine service from odometer, service history and recent usage, kept separate from scheduled work." },
  { icon: Users, title: "Driver performance", text: "A documented score, trends and fleet comparisons, and no ranking where there is too little evidence." },
  { icon: Sparkles, title: "Explained changes", text: "When a metric moves between periods, the analytics page says by how much and which records drove it." },
];

const ROLES = [
  { name: "Super Admin", text: "Everything, including user accounts, system settings and the audit log." },
  { name: "Fleet Manager", text: "Vehicles, drivers, fuel, maintenance, analytics and reports." },
  { name: "Dispatcher", text: "Creates and assigns deliveries, plans routes and watches the live map." },
  { name: "Driver", text: "Sees only their own deliveries, updates status and reports issues." },
];

const STACK = ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS 4", "Prisma", "SQLite", "Socket.IO", "Leaflet", "OpenStreetMap", "Recharts", "Zod", "Vitest", "Playwright"];

const ENGINEERING: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Layers, title: "Layered architecture", text: "Thin REST handlers, a service layer that owns the business rules, and pure domain modules for every calculation." },
  { icon: ShieldCheck, title: "Server-side access control", text: "Role permissions are checked on every page and API call, and data is scoped per user inside the services." },
  { icon: Radio, title: "Realtime by design", text: "One Node process serves the app, the websocket channel and the GPS simulation engine." },
  { icon: Database, title: "Relational data model", text: "Fourteen Prisma models with migrations, integer money, soft deletes and audit history." },
  { icon: TestTube2, title: "Tested end to end", text: "Unit, integration and browser tests cover the rules, the API boundaries and the main user journeys." },
  { icon: KeyRound, title: "No keys, no accounts", text: "Maps, routing and analytics run on open-source software and local algorithms. Nothing to sign up for." },
];

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="LogiTrack home">
      <span className="grid size-8 place-items-center rounded-md bg-primary text-white">
        <Truck className="size-[18px]" aria-hidden />
      </span>
      <span className={`text-[17px] font-semibold tracking-tight ${dark ? "text-ink" : "text-white"}`}>LogiTrack</span>
    </Link>
  );
}

function FeatureRow({
  eyebrow, title, text, points, image, alt, path, flip,
}: {
  eyebrow: string; title: string; text: string; points: string[]; image: string; alt: string; path: string; flip?: boolean;
}) {
  return (
    <Reveal className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
      <div className={`lg:col-span-5 ${flip ? "lg:order-2" : ""}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-[28px] sm:leading-tight">{title}</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{text}</p>
        <ul className="mt-5 space-y-2.5">
          {points.map((p) => (
            <li key={p} className="flex gap-2.5 text-sm text-ink-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={`lg:col-span-7 ${flip ? "lg:order-1" : ""}`}>
        <BrowserFrame src={image} alt={alt} path={path} />
      </div>
    </Reveal>
  );
}

export default async function LandingPage() {
  const user = await getCurrentUser();
  const demo = isDemoMode();
  const primary = user
    ? { href: homeFor(user.role), label: "Open the app" }
    : demo
      ? { href: "/login#demo", label: "Explore the live demo" }
      : { href: "/login", label: "Sign in" };

  return (
    <div className="bg-surface text-ink">
      {/* Header + hero share the navy field */}
      <div className="hero-grid bg-navy-950">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo />
          <nav aria-label="Sections" className="hidden items-center gap-7 text-sm text-navy-200 md:flex">
            <a href="#platform" className="hover:text-white">Platform</a>
            <a href="#intelligence" className="hover:text-white">Intelligence</a>
            <a href="#roles" className="hover:text-white">Roles</a>
            <a href="#technology" className="hover:text-white">Technology</a>
          </nav>
          <div className="flex items-center gap-2">
            {!user && (
              <Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium text-navy-200 hover:text-white">
                Sign in
              </Link>
            )}
            <Link href={primary.href} className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-hover">
              {user ? "Open the app" : demo ? "Try the demo" : "Sign in"}
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-5 pb-0 pt-10 text-center sm:pt-16">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-navy-700 bg-navy-900/70 px-3 py-1 text-xs text-navy-200">
            <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
            Logistics and fleet management platform
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-[56px]">
            Run your delivery fleet from one control room.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-navy-200 sm:text-lg">
            LogiTrack brings vehicles, drivers, deliveries, routes, fuel and maintenance into a single system, then tells you what needs attention:
            which deliveries are at risk, which vehicles sit idle and where costs are moving.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={primary.href} className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary-hover">
              {primary.label}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a href="#platform" className="rounded-md border border-navy-700 px-5 py-3 text-sm font-semibold text-white hover:bg-navy-800">
              See the platform
            </a>
          </div>
          {demo && !user && <p className="mt-4 text-xs text-navy-300">No sign-up. One click signs you in as any of four roles, on sample data.</p>}

          <div className="mx-auto mt-12 max-w-5xl translate-y-10 sm:translate-y-16">
            <BrowserFrame src="/screenshots/dashboard.png" alt="LogiTrack dashboard showing fleet KPIs, delivery performance and vehicle status" path="/dashboard" priority />
          </div>
        </section>
      </div>

      <main>
        {/* Capabilities */}
        <section id="platform" className="mx-auto max-w-6xl scroll-mt-8 px-5 pb-6 pt-28 sm:pt-36">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">The platform</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Every part of a delivery operation, connected.</h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
              The modules share one data model, so an action in one place is reflected everywhere: assigning a delivery occupies its driver and vehicle,
              completing it frees them, updates the odometer and feeds the analytics.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c, i) => (
              <Reveal key={c.title} delay={i * 50} className="bg-surface p-6">
                <span className="grid size-9 place-items-center rounded-md bg-primary-soft text-primary">
                  <c.icon className="size-[18px]" aria-hidden />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold text-ink">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{c.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Product previews: real screenshots */}
        <section className="mx-auto max-w-6xl space-y-20 px-5 py-20 sm:space-y-28">
          <FeatureRow
            eyebrow="Fleet tracking"
            title="See every vehicle, where it is and what it is carrying."
            text="The live map updates as vehicles move. Select one to see its driver, the delivery on board, the destination and how far along the route it is."
            points={[
              "Markers move in place over a websocket; no refreshing",
              "Search and filter by status, follow a single vehicle",
              "Route drawn on OpenStreetMap, with pause and resume",
            ]}
            image="/screenshots/tracking.png"
            alt="Live tracking map with a selected truck, its route and delivery details"
            path="/tracking"
          />
          <FeatureRow
            flip
            eyebrow="Delivery management"
            title="A delivery workflow that cannot be skipped or double-booked."
            text="Each consignment moves through defined stages. The system refuses invalid transitions and will not assign a driver or vehicle that is busy, off duty or under maintenance."
            points={[
              "Assign, reassign, delay, fail or cancel, each with a recorded reason",
              "Driver and vehicle availability updated automatically",
              "A timeline of every event, with who did it and when",
            ]}
            image="/screenshots/delivery-detail.png"
            alt="Delivery detail page with progress steps, route map and event history"
            path="/deliveries/DEL-0081"
          />
          <FeatureRow
            eyebrow="Route optimisation"
            title="Turn a list of deliveries into an efficient run."
            text="Pick the pending deliveries for a vehicle and the planner orders the stops. It compares three strategies side by side and always keeps a pickup ahead of its drop-off."
            points={[
              "Nearest-neighbour ordering refined with 2-opt",
              "Distance, duration and stops for each option",
              "Save the route and dispatch every delivery on it at once",
            ]}
            image="/screenshots/routes.png"
            alt="Route planner comparing three route options with stops on a map"
            path="/routes"
          />
          <FeatureRow
            flip
            eyebrow="Analytics"
            title="Know what changed, and why."
            text="Compare this period with the last one or with the same period a year ago. Alongside the numbers, LogiTrack writes out what moved and which records were behind it."
            points={[
              "Reliability, cost, utilisation and productivity views",
              "Fuel and maintenance cost analysis per vehicle",
              "Every figure computed from stored records, exportable as CSV",
            ]}
            image="/screenshots/analytics.png"
            alt="Analytics page with KPIs, delivery trends and status distribution"
            path="/analytics"
          />
        </section>

        {/* Intelligence */}
        <section id="intelligence" className="scroll-mt-8 bg-navy-950 py-20 text-white">
          <div className="mx-auto max-w-6xl px-5">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-300">Built-in intelligence</p>
              <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">It does not just store your operation. It reads it.</h2>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-navy-200">
                Every insight comes from a transparent rule applied to your own records, and each one states its reason. There is no black box and no
                external AI service: the logic runs locally and is documented.
              </p>
            </Reveal>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {INTELLIGENCE.map((item, i) => (
                <Reveal key={item.title} delay={i * 50} className="rounded-lg border border-navy-800 bg-navy-900 p-5">
                  <item.icon className="size-5 text-navy-200" aria-hidden />
                  <h3 className="mt-3 text-[15px] font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-navy-300">{item.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="roles" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-12">
            <Reveal className="lg:col-span-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Roles and access</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">The right view for each person.</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                Four roles see four different applications. Permissions are enforced on the server for every page and every API request, so hiding a
                button is never the only line of defence.
              </p>
              <Link href={user ? homeFor(user.role) : "/login#demo"} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
                {user ? "Back to the app" : demo ? "Sign in as any role" : "Sign in"}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Reveal>
            <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:col-span-7">
              {ROLES.map((r, i) => (
                <Reveal key={r.name} delay={i * 50} className="bg-surface p-5">
                  <h3 className="text-[15px] font-semibold text-ink">{r.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">{r.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Technology */}
        <section id="technology" className="scroll-mt-8 border-y border-line bg-canvas py-20">
          <div className="mx-auto max-w-6xl px-5">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Technology</p>
              <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">A full-stack application, built to be read.</h2>
              <ul className="mt-5 flex flex-wrap gap-2" aria-label="Technology stack">
                {STACK.map((s) => (
                  <li key={s} className="rounded-sm border border-line-strong bg-surface px-2.5 py-1 font-mono text-xs text-ink-2">{s}</li>
                ))}
              </ul>
            </Reveal>
            <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {ENGINEERING.map((e, i) => (
                <Reveal key={e.title} delay={i * 40}>
                  <e.icon className="size-5 text-primary" aria-hidden />
                  <h3 className="mt-2.5 text-[15px] font-semibold text-ink">{e.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">{e.text}</p>
                </Reveal>
              ))}
            </div>
            <Reveal className="mt-12 flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
              <Activity className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <p>
                <strong className="font-semibold text-ink">About this project.</strong> LogiTrack is an independent software engineering project, not a
                commercial service. The data in the demo is sample data, vehicle positions come from a built-in GPS simulator rather than tracking
                hardware, and route distances are planning estimates.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-6xl px-5 py-20 text-center">
          <Reveal>
            <span className="mx-auto grid size-11 place-items-center rounded-md bg-primary-soft text-primary">
              <Boxes className="size-5" aria-hidden />
            </span>
            <h2 className="mx-auto mt-4 max-w-xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">See it working.</h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink-2">
              {demo
                ? "Open the demo, pick a role and take the two-minute guided tour. Create a delivery, dispatch it and watch it move across the map."
                : "Sign in to open the control room."}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href={primary.href} className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary-hover">
                {primary.label}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              {!user && (
                <Link href="/login" className="rounded-md border border-line-strong px-5 py-3 text-sm font-semibold text-ink hover:bg-neutral-soft">
                  Sign in
                </Link>
              )}
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-ink-3">
          <div className="flex items-center gap-3">
            <Logo dark />
            <span className="hidden sm:inline">Fleet and logistics management</span>
          </div>
          <p className="flex items-center gap-1.5">
            Map data © <a href="https://www.openstreetmap.org/copyright" className="underline hover:text-ink" rel="noreferrer">OpenStreetMap</a> contributors · Screenshots are of the running application
          </p>
        </div>
      </footer>
    </div>
  );
}
