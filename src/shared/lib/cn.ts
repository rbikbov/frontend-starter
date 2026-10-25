import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins classes: the last conflicting Tailwind class wins. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
