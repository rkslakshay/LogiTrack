import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";

interface Scoring {
  weights: { success: number; onTime: number; experience: number };
  experienceTarget: number;
  minRatedDeliveries: number;
}

/** Explains exactly how the performance score is calculated, next to wherever it is shown. */
export function ScoringNote({ scoring }: { scoring: Scoring }) {
  const w = scoring.weights;
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Info className="size-4 text-primary" aria-hidden />
        How the performance score is calculated
      </p>
      <p className="mt-2 rounded-md bg-canvas px-3 py-2 font-mono text-xs text-ink">
        score = 100 × ({w.success} × success rate + {w.onTime} × on-time rate + {w.experience} × experience)
      </p>
      <ul className="mt-2 space-y-1 text-xs text-ink-2">
        <li><strong className="font-medium text-ink">Success rate</strong> = delivered ÷ (delivered + failed). Cancelled deliveries are a business decision and are excluded.</li>
        <li><strong className="font-medium text-ink">On-time rate</strong> = delivered on or before the expected time ÷ delivered.</li>
        <li><strong className="font-medium text-ink">Experience</strong> = min(1, delivered ÷ {scoring.experienceTarget}), so a perfect record on very few jobs does not outrank sustained performance.</li>
        <li>Drivers with fewer than {scoring.minRatedDeliveries} closed deliveries in the period are shown as “Not rated” instead of being ranked.</li>
        <li><strong className="font-medium text-ink">Completion rate</strong> = delivered ÷ (delivered + failed + cancelled). It is shown for context and is not part of the score.</li>
        <li><strong className="font-medium text-ink">30-day trend</strong> = on-time rate in the last 30 days minus the 30 days before, reported only when each window has at least 3 delivered jobs.</li>
      </ul>
    </Card>
  );
}
