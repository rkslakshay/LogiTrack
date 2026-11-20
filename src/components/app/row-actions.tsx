"use client";

import * as React from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

export interface RowAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  tone?: "danger";
  disabled?: boolean;
  /** Draw a separator above this item. */
  separated?: boolean;
  hidden?: boolean;
}

/** "…" menu for table rows. */
export function RowActions({ actions, label = "Row actions" }: { actions: RowAction[]; label?: string }) {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-neutral-soft hover:text-ink data-[state=open]:bg-neutral-soft"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </MenuTrigger>
      <MenuContent onClick={(e) => e.stopPropagation()}>
        {visible.map((action) => (
          <React.Fragment key={action.label}>
            {action.separated && <MenuSeparator />}
            <MenuItem tone={action.tone} disabled={action.disabled} onSelect={action.onSelect}>
              {action.icon && <action.icon />}
              {action.label}
            </MenuItem>
          </React.Fragment>
        ))}
      </MenuContent>
    </Menu>
  );
}
