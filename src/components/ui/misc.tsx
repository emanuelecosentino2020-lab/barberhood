import type { ReactNode } from "react";
import { cn } from "./cn";
import type { AppointmentStatus } from "@/lib/types";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-line bg-surface", className)}>{children}</div>;
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  confirmed: "Confermato",
  completed: "Completato",
  cancelled: "Annullato",
  no_show: "Non presentato",
};

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  confirmed: "border-text/30 text-text",
  completed: "border-success/40 text-success",
  cancelled: "border-line-strong text-subtle line-through decoration-1",
  no_show: "border-warning/50 text-warning",
};

export function statusLabel(status: AppointmentStatus) {
  return STATUS_LABEL[status];
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "error" | "success" | "warning";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-line-strong",
    error: "border-danger/50 text-danger",
    success: "border-success/50",
    warning: "border-warning/50",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title ? "mt-1" : undefined, tone === "error" ? "" : "text-muted")}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Avatar({ name, src, size = 44, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- user-provided remote/static images of unknown size
    <img src={src} alt="" width={size} height={size} className={cn("shrink-0 rounded-full object-cover grayscale", className)} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-sm font-medium text-muted", className)}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}
