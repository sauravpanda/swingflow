import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safe .toFixed for values that may not be numbers. Guards against
 * old DB rows persisted before server-side response coercion shipped
 * — those rows can contain strings, nulls, or NaNs where a number is
 * expected. Returns the fallback (default "—") on anything non-finite.
 */
export function fmtScore(
  v: unknown,
  digits: number = 1,
  fallback: string = "—"
): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return v.toFixed(digits);
}
