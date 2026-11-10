import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

/** A clock that only ticks while something is being timed. */
export function useTimerNow(running: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    // The clock stood still while nothing ran, so catch up before ticking.
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [running]);
  return now;
}

export function formatMinutes(value: number): string {
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? t`${hours}h ${minutes}m` : `${hours}h`;
}
