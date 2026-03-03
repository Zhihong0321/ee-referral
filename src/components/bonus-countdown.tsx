"use client";

import { useEffect, useMemo, useState } from "react";

type TimeLeft = {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const BONUS_END_DATE_TEXT = "31/3/2026";

function calculateTimeLeft(nowMs: number, targetMs: number): TimeLeft {
  const totalMs = Math.max(0, targetMs - nowMs);
  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { totalMs, days, hours, minutes, seconds };
}

export default function BonusCountdown() {
  const targetMs = useMemo(() => new Date(2026, 2, 31, 23, 59, 59, 999).getTime(), []);
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => calculateTimeLeft(Date.now(), targetMs));

  useEffect(() => {
    if (timeLeft.totalMs <= 0) return;

    const timer = window.setInterval(() => {
      setTimeLeft(calculateTimeLeft(Date.now(), targetMs));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [targetMs, timeLeft.totalMs]);

  if (timeLeft.totalMs <= 0) {
    return (
      <p className="hero-reveal hero-delay mt-4 inline-flex w-fit rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
        +0.5% extra referral fee campaign ended on {BONUS_END_DATE_TEXT}
      </p>
    );
  }

  return (
    <p className="hero-reveal hero-delay mt-4 inline-flex w-fit flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span className="font-semibold">+0.5% extra referral fee until {BONUS_END_DATE_TEXT}</span>
      <span className="rounded-md bg-white px-2 py-1 font-mono text-xs font-semibold text-slate-800">
        {timeLeft.days}d {String(timeLeft.hours).padStart(2, "0")}h {String(timeLeft.minutes).padStart(2, "0")}m{" "}
        {String(timeLeft.seconds).padStart(2, "0")}s
      </span>
    </p>
  );
}
