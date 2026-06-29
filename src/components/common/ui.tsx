// Tiny shared UI primitives (dark theme). Keeps Tailwind class noise out of features.
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "accent" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  default:
    "bg-surface-2 hover:bg-surface-3 border border-border text-ink disabled:opacity-40",
  accent:
    "bg-accent hover:brightness-110 text-white border border-transparent disabled:opacity-40",
  ghost: "bg-transparent hover:bg-surface-2 text-ink-dim hover:text-ink border border-transparent",
  danger: "bg-transparent hover:bg-danger/15 text-danger border border-transparent",
};

export function Button({
  variant = "default",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-[4px] py-[2px] text-xs font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-dim transition hover:bg-surface-2 hover:text-ink disabled:opacity-40 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      {label && (
        <span className="text-xs font-medium text-ink-faint uppercase tracking-wide">{label}</span>
      )}
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-border bg-surface-0 px-[4px] py-[2px] text-xs text-ink outline-none focus:border-accent placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-40";

export const selectClass =
  "w-full rounded-md border border-border bg-surface-0 px-[4px] py-[2px] text-xs text-ink outline-none focus:border-accent";
