import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — merge Tailwind classes without conflicts.
 * Combines clsx (conditional classes) and tailwind-merge (conflict resolution).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Avatar color palette — 6 slots, CHAT-02 requirement.
 * Color is derived deterministically from author_id so the same
 * author always gets the same color across page reloads.
 */
const AVATAR_COLORS = [
  "#818cf8", // Indigo 400
  "#34d399", // Emerald 400
  "#fbbf24", // Amber 400
  "#fb7185", // Rose 400
  "#38bdf8", // Sky 400
  "#a78bfa", // Violet 400
] as const;

/**
 * getAvatarColor — deterministic hash of authorId → one of 6 colors.
 * Uses a simple but stable character-sum hash (FNV-inspired accumulator).
 * Never uses Math.random() — color must be stable across renders.
 */
export function getAvatarColor(authorId: string): string {
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    // FNV-1a inspired: multiply by 31 prime and XOR with char code
    hash = (hash * 31 + authorId.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}
