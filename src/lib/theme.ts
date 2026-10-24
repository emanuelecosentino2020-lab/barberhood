import type { CSSProperties } from "react";

const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** CSS variables for a business brand. Accent ink is picked for contrast. */
export function themeStyle(theme: Record<string, unknown> | null | undefined): CSSProperties {
  const accent = typeof theme?.accent === "string" && HEX.test(theme.accent) ? theme.accent : null;
  if (!accent) return {};
  return {
    ["--accent" as string]: accent,
    ["--accent-ink" as string]: luminance(accent) > 0.4 ? "#0a0a0a" : "#ffffff",
    ["--ring" as string]: accent,
  };
}

export function themeString(theme: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = theme?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
