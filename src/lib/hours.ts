export const WEEKDAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"] as const;
export const WEEKDAYS_SHORT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"] as const;

export interface HoursRow {
  weekday: number;
  start: string;
  end: string;
}

/** One entry per weekday (1..7) with its intervals, e.g. "09:00–13:00, 15:00–20:00" */
export function weeklySummary(hours: HoursRow[]): { weekday: number; label: string; text: string | null }[] {
  return WEEKDAYS.map((label, i) => {
    const day = hours
      .filter((h) => h.weekday === i + 1)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((h) => `${h.start}–${h.end === "24:00" ? "24:00" : h.end}`);
    return { weekday: i + 1, label, text: day.length ? day.join(" · ") : null };
  });
}
