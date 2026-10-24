import { formatLongDate, formatTime } from "@/lib/booking/time";
import { formatPrice } from "@/lib/format";
import type { NotificationKind } from "@/lib/types";

export interface EmailContext {
  kind: NotificationKind;
  siteUrl: string;
  business: {
    name: string;
    timezone: string;
    currency: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null; // raster image (PNG/JPG): many email clients block SVG
    accent: string;
    slug: string;
  };
  appointment: {
    startsAt: string;
    endsAt: string;
    serviceName: string;
    priceCents: number;
    staffName: string;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    customerNote: string | null;
    cancellationReason: string | null;
    previousStartsAt: string | null;
  };
  manageUrl: string | null;
  adminUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absolute(siteUrl: string, url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  return `${siteUrl.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

function googleCalendarUrl(ctx: EmailContext): string {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${ctx.appointment.serviceName} · ${ctx.business.name}`,
    dates: `${fmt(ctx.appointment.startsAt)}/${fmt(ctx.appointment.endsAt)}`,
    details: ctx.manageUrl ? `Gestisci la prenotazione: ${ctx.manageUrl}` : "",
    location: ctx.business.address ?? "",
    ctz: ctx.business.timezone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

interface Copy {
  subject: string;
  heading: string;
  intro: string;
  showManage: boolean;
  showCalendar: boolean;
}

function copyFor(ctx: EmailContext, when: string): Copy {
  const a = ctx.appointment;
  const first = a.customerName.split(" ")[0] ?? a.customerName;
  switch (ctx.kind) {
    case "booking_confirmed":
      return {
        subject: `Prenotazione confermata · ${when}`,
        heading: "Prenotazione confermata",
        intro: `Ciao ${first}, ti aspettiamo. Qui sotto trovi tutti i dettagli.`,
        showManage: true,
        showCalendar: true,
      };
    case "booking_rescheduled":
      return {
        subject: `Appuntamento spostato · ${when}`,
        heading: "Appuntamento spostato",
        intro: `Ciao ${first}, il tuo appuntamento ha un nuovo orario.`,
        showManage: true,
        showCalendar: true,
      };
    case "booking_cancelled":
      return {
        subject: `Appuntamento annullato · ${when}`,
        heading: "Appuntamento annullato",
        intro: `Ciao ${first}, il tuo appuntamento è stato annullato.${a.cancellationReason ? ` Motivo: ${a.cancellationReason}` : ""} Puoi prenotarne uno nuovo quando vuoi.`,
        showManage: false,
        showCalendar: false,
      };
    case "reminder":
      return {
        subject: `Promemoria · ${when}`,
        heading: "Ci vediamo presto",
        intro: `Ciao ${first}, ti ricordiamo il tuo appuntamento. Se non puoi venire, avvisaci: libererai il posto per qualcun altro.`,
        showManage: true,
        showCalendar: false,
      };
    case "owner_new_booking":
      return {
        subject: `Nuova prenotazione · ${a.customerName} · ${when}`,
        heading: "Nuova prenotazione online",
        intro: `${a.customerName} ha prenotato ${a.serviceName}.`,
        showManage: false,
        showCalendar: false,
      };
    case "owner_booking_cancelled":
      return {
        subject: `Disdetta · ${a.customerName} · ${when}`,
        heading: "Un cliente ha disdetto",
        intro: `${a.customerName} ha annullato l'appuntamento. Lo slot è di nuovo libero.`,
        showManage: false,
        showCalendar: false,
      };
  }
}

export function renderEmail(ctx: EmailContext): RenderedEmail {
  const { business: b, appointment: a } = ctx;
  const tz = b.timezone;
  const dateLong = formatLongDate(a.startsAt, tz);
  const time = formatTime(a.startsAt, tz);
  const when = `${dateLong} alle ${time}`;
  const copy = copyFor(ctx, `${formatLongDate(a.startsAt, tz).replace(/ \d{4}$/, "")}, ${time}`);
  const isOwner = ctx.kind === "owner_new_booking" || ctx.kind === "owner_booking_cancelled";

  const rows: [string, string][] = [
    ["Servizio", a.serviceName],
    ["Quando", when],
  ];
  if (a.previousStartsAt && ctx.kind === "booking_rescheduled") {
    rows.push(["Prima era", `${formatLongDate(a.previousStartsAt, tz)} alle ${formatTime(a.previousStartsAt, tz)}`]);
  }
  if (a.staffName) rows.push(["Con", a.staffName]);
  rows.push(["Prezzo", formatPrice(a.priceCents, b.currency)]);
  if (isOwner) {
    if (a.customerPhone) rows.push(["Telefono", a.customerPhone]);
    if (a.customerEmail) rows.push(["Email", a.customerEmail]);
    if (a.customerNote) rows.push(["Nota", a.customerNote]);
  } else if (b.address) {
    rows.push(["Dove", b.address]);
  }

  const logo = absolute(ctx.siteUrl, b.logoUrl);
  const accent = /^#[0-9a-fA-F]{6}$/.test(b.accent) ? b.accent : "#111111";
  const buttons: { label: string; href: string; primary: boolean }[] = [];
  if (isOwner) buttons.push({ label: "Apri il calendario", href: ctx.adminUrl, primary: true });
  if (!isOwner && copy.showManage && ctx.manageUrl) buttons.push({ label: "Sposta o annulla", href: ctx.manageUrl, primary: true });
  if (!isOwner && copy.showCalendar) buttons.push({ label: "Aggiungi al calendario", href: googleCalendarUrl(ctx), primary: false });
  if (ctx.kind === "booking_cancelled") {
    buttons.push({ label: "Prenota di nuovo", href: `${ctx.siteUrl.replace(/\/$/, "")}/${b.slug}/prenota`, primary: true });
  }

  const contact = [b.phone, b.email].filter(Boolean).join(" · ");
  const e = escapeHtml;

  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${e(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f1ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141414;">
<div style="display:none;max-height:0;overflow:hidden;">${e(copy.intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ee;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;">
<tr><td style="background:#111111;padding:28px 32px;" align="left">
${logo ? `<img src="${e(logo)}" alt="${e(b.name)}" height="28" style="display:block;height:28px;width:auto;border:0;">` : `<span style="color:#ffffff;font-size:18px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;">${e(b.name)}</span>`}
</td></tr>
<tr><td style="padding:32px 32px 8px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:650;color:#111111;">${e(copy.heading)}</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#45433f;">${e(copy.intro)}</p>
</td></tr>
<tr><td style="padding:16px 32px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e5e0;">
${rows
  .map(
    ([k, v]) => `<tr>
<td style="padding:12px 0;border-bottom:1px solid #e7e5e0;font-size:13px;color:#7a776f;width:34%;vertical-align:top;">${e(k)}</td>
<td style="padding:12px 0;border-bottom:1px solid #e7e5e0;font-size:15px;color:#141414;font-weight:500;">${e(v)}</td>
</tr>`,
  )
  .join("\n")}
</table>
</td></tr>
${
  buttons.length
    ? `<tr><td style="padding:20px 32px 8px;">${buttons
        .map(
          (btn) =>
            `<a href="${e(btn.href)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 20px;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none;${
              btn.primary ? `background:#111111;color:#ffffff;border:1px solid #111111;` : `background:#ffffff;color:#111111;border:1px solid #cfccc5;`
            }">${e(btn.label)}</a>`,
        )
        .join("")}</td></tr>`
    : ""
}
<tr><td style="padding:16px 32px 28px;">
<p style="margin:0;font-size:12px;line-height:1.6;color:#8d8a82;">${e(b.name)}${b.address ? ` · ${e(b.address)}` : ""}${contact ? `<br>${e(contact)}` : ""}</p>
<p style="margin:10px 0 0;font-size:11px;line-height:1.5;color:#a9a69e;">Email di servizio relativa alla tua prenotazione. Non riceverai comunicazioni promozionali.</p>
</td></tr>
<tr><td style="height:4px;background:${accent};"></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    copy.heading,
    "",
    copy.intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    ...buttons.map((btn) => `${btn.label}: ${btn.href}`),
    "",
    [b.name, b.address, contact].filter(Boolean).join(" · "),
  ].join("\n");

  return { subject: copy.subject, html, text };
}
