/** Medianoche (o fin del día) de una fecha yyyy-mm-dd en Europe/Madrid, en ISO UTC. */
export function madridDayBoundary(day: string, endOfDay = false): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const probe = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(probe.getTime())) return null;
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" })
      .formatToParts(probe)
      .find((part) => part.type === "timeZoneName")
      ?.value.replace("GMT", "") || "+00:00";
  return new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00"}${offset}`).toISOString();
}
