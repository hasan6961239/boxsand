import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** يدمج أصناف Tailwind ويحسم التعارض بينها لصالح الأخير. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
