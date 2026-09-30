"use client";

import { useState } from "react";
import { cx, inputClass } from "@/components/ui/primitives";

/** Hex colour field: native picker + text input, may be left empty. Submits `name` = "#rrggbb" or "". */
export function ColorInput({ name, defaultValue, label, id }: { name: string; defaultValue?: string | null; label: string; id?: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={valid ? value : "#000000"}
        onChange={(e) => setValue(e.target.value)}
        className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1"
      />
      <input
        id={id}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        placeholder="#4f46e5"
        pattern="^#[0-9a-fA-F]{6}$"
        dir="ltr"
        aria-label={label}
        className={cx(inputClass, "num w-28 font-mono")}
      />
    </div>
  );
}
