import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Склейка классов: последний конфликтующий класс Tailwind побеждает. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
