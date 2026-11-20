"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/app/page";
import { Card } from "@/components/ui/card";

// Catches rendering errors inside the signed-in area so the shell stays usable.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card>
      <ErrorState message="Something went wrong while displaying this page. You can try again, or use the menu to go elsewhere." onRetry={reset} />
    </Card>
  );
}
