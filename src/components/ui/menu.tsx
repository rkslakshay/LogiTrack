"use client";

import * as React from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;

export function MenuContent({ className, align = "end", ...props }: Dropdown.DropdownMenuContentProps) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-44 animate-fade-in rounded-lg border border-line bg-surface p-1 shadow-pop", className)}
        {...props}
      />
    </Dropdown.Portal>
  );
}

export function MenuItem({ className, tone, ...props }: Dropdown.DropdownMenuItemProps & { tone?: "danger" }) {
  return (
    <Dropdown.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4",
        tone === "danger" ? "text-danger data-[highlighted]:bg-danger-soft" : "text-ink data-[highlighted]:bg-neutral-soft",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <Dropdown.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <Dropdown.Label className="px-2.5 py-1.5 text-xs text-ink-3">{children}</Dropdown.Label>;
}
