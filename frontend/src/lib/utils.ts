import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// src/lib/utils.ts
export function cn2(
  ...classes: Array<string | number | null | undefined | false>
): string {
  return classes.filter(Boolean).join(" ");
}
