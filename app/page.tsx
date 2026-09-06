"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addDays, addInterval, daysBetween, dueDate, fromISO, holidayDate, intervalDays, nextHolidayDate, previousAnnualDate, today, toISO } from "@/lib/item-dates";
import NotificationsPanel from "./notifications-panel";
import { isDashboardVisible } from "@/lib/item-visibility";
import { RowTransport } from "@/lib/row-transport";
import { CompletionHistory } from "@/app/components/completion-history";
import { HouseholdSync } from "@/lib/household-sync";
import { annualEditDate, applyItemEdit, normalizeStoredItem, recordCompletion, removeLatestCompletion } from "@/lib/item-mutations";
import { fetchCsvExport, type CsvExportKind } from "@/lib/csv-export";
import type { HistoryEntry, HolidayKey, TrackedItem, Unit, WeekdayRule } from "@/lib/household-schema";

import { HolidayScheduleFields } from "./holiday-schedule-fields";

type Screen = "manage" | "dashboard" | "holidays" | "celebrations" | "notifications";
type ThemeId = "light" | "dark" | "forest" | "clay" | "purple" | "dark-purple" | "edgy";

type HolidayDefinition = { key: HolidayKey; name: string; note: string };
const THEMES: ReadonlyArray<{ id: ThemeId; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "forest", label: "Forest" },
  { id: "clay", label: "Clay" },
  { id: "purple", label: "Purple" },
  { id: "dark-purple", label: "Dark Purple" },
  { id: "edgy", label: "Edgy" },
];

const DISPLAY_ITEM_LIMIT = 10;
const EVENT_COUNTDOWN_DAYS = 50;

const HOLIDAYS: HolidayDefinition[] = [
  { key: "new-year", name: "New Year’s Day", note: "January 1" },
  { key: "mlk-day", name: "Martin Luther King Jr. Day", note: "Third Monday in January" },
  { key: "valentines", name: "Valentine’s Day", note: "February 14" },
  { key: "presidents-day", name: "Presidents’ Day", note: "Third Monday in February" },
  { key: "memorial-day", name: "Memorial Day", note: "Last Monday in May" },
  { key: "independence-day", name: "Independence Day", note: "July 4" },
  { key: "labor-day", name: "Labor Day", note: "First Monday in September" },
  { key: "halloween", name: "Halloween", note: "October 31" },
  { key: "thanksgiving", name: "Thanksgiving", note: "Fourth Thursday in November" },
  { key: "christmas", name: "Christmas Day", note: "December 25" },
];

function plural(value: number, word: string) {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

function largerDuration(days: number) {
  const absolute = Math.abs(days);
  if (absolute < 14) return null;
  const [unit, length] = absolute < 60
    ? ["week", 7]
    : absolute < 730
      ? ["month", 30.44]
      : ["year", 365.25];
  const raw = absolute / length;
  const rounded = Math.max(1, Math.round(raw));
  const relation = Math.abs(raw - rounded) < 0.001 ? "" : raw < rounded ? "under " : "over ";
  return `${relation}${plural(rounded, unit)}`;
}

function formatDate(value: string, short = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: short ? "short" : "long",
    day: "numeric",
    year: short ? undefined : "numeric",
  }).format(fromISO(value));
}

function formatDueDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMonthDayDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
}

function displayVerb(item: TrackedItem) {
  if (item.verb?.trim()) return item.verb.trim();
  const known: Record<string, string> = {
    hvac: "Change",
    fridge: "Replace",
    smoke: "Test",
    cat: "Apply",
    heater: "Flush",
    vacation: "Depart",
  };
  return known[item.id] || (item.type === "fixed" ? "Anticipate" : "Maintain");
}

function statusFor(item: TrackedItem) {
  const remaining = daysBetween(today(), dueDate(item));
  if (remaining < 0) return "overdue";
  if (remaining === 0) return "due";
  if (remaining <= item.reminderDays) return "soon";
  if (remaining <= item.reminderDays * 2) return "approaching";
  return "normal";
}

function currentProgress(item: TrackedItem) {
  if (item.type === "recurring") {
    const start = fromISO(item.lastCompleted || item.createdAt);
    const target = dueDate(item);
    const total = Math.max(1, daysBetween(start, target));
    return Math.max(0, daysBetween(start, today()) / total);
  }
  const target = dueDate(item);
  if (item.source) {
    const start = previousAnnualDate(item);
    if (daysBetween(start, today()) === 0 && daysBetween(today(), target) === 0) return 1;
    return Math.max(0, daysBetween(start, today()) / Math.max(1, daysBetween(start, target)));
  }
  if (item.annual) {
    const start = new Date(target);
    start.setFullYear(start.getFullYear() - 1);
    return Math.max(0, daysBetween(start, today()) / Math.max(1, daysBetween(start, target)));
  }
  const created = fromISO(item.createdAt);
  const countdownWindowStart = addDays(target, -EVENT_COUNTDOWN_DAYS);
  const start = created < countdownWindowStart ? created : countdownWindowStart;
  return Math.max(0, daysBetween(start, today()) / Math.max(1, daysBetween(start, target)));
}

function Donut({ progress, status, size = "large", label }: { progress: number; status: string; size?: "large" | "small"; label: string }) {
  const capped = Math.min(progress, 1);
  const overrun = Math.min(Math.max(progress - 1, 0), 1);
  return (
    <div
      className={`donut donut--${size} status-${status} ${progress > 2 ? "donut--double" : progress > 1 ? "donut--overrun" : ""}`}
      style={{ "--progress": `${capped * 360}deg`, "--overrun-progress": `${overrun * 360}deg` } as React.CSSProperties}
      role="img"
      aria-label={label}
    >
      <div className="donut__center">
        {size === "large" && <span className="donut__number">{Math.round(progress * 100)}</span>}
        {size === "large" && <span className="donut__unit">%</span>}
      </div>
    </div>
  );
}

function CycleDonut({ current, previous, item }: { current: HistoryEntry; previous?: HistoryEntry; item: TrackedItem }) {
  if (!previous) return null;
  const actual = daysBetween(fromISO(previous.date), fromISO(current.date));
  const scheduled = intervalDays(item, fromISO(previous.date));
  const progress = actual / scheduled;
  const variance = actual - scheduled;
  const state = variance > 2 ? "overdue" : variance < -2 ? "early" : "on time";
  return (
    <span className="cycle" role="img" aria-label={`${formatDate(current.date)}: ${actual} days, ${state}`} data-tip={`${formatDate(current.date)} · ${actual} days · ${state}`}>
      <Donut progress={progress} status={state === "overdue" ? "overdue" : state === "early" ? "normal" : "on-time"} size="small" label={`${actual} day cycle, ${state}`} />
    </span>
  );
}

function ItemRow({ item, onOpen, preserveVerbSpace = false }: { item: TrackedItem; onOpen?: () => void; preserveVerbSpace?: boolean }) {
  const now = today();
  const due = dueDate(item);
  const remaining = daysBetween(now, due);
  const status = statusFor(item);
  const progress = currentProgress(item);
  const last = item.lastCompleted ? daysBetween(fromISO(item.lastCompleted), now) : null;
  const daysSinceOccurrence = item.source ? daysBetween(previousAnnualDate(item), now) : null;
  const history = [...item.history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const largerTime = largerDuration(remaining);
  const intervalLabel = item.type === "recurring"
    ? `Every ${item.intervalValue} ${item.intervalUnit}`
    : item.source ? null : item.annual ? "Repeats annually" : "One-time date";
  const content = (
    <>
        <div className="item-copy">
          <div className="eyebrow-line">
            <span className={`status-dot status-${status}`} />
            <span>{item.category || (item.type === "fixed" ? "Countdown" : "Household")}</span>
            {intervalLabel && <><span>·</span><span>{intervalLabel}</span></>}
            {item.snoozedUntil && <span className="snoozed-label">Snoozed</span>}
          </div>
          {!item.source
            ? <p className="item-verb">{displayVerb(item)}</p>
            : preserveVerbSpace && <p className="item-verb item-verb--placeholder" aria-hidden="true">&nbsp;</p>}
          <h2>{item.title}</h2>
          <p className={`timing-status status-${status}`}>
            {item.type === "recurring" && <span>{last === null ? "NEVER COMPLETED" : `${plural(last, "day")} since`}</span>}
            {daysSinceOccurrence !== null && <span>{plural(daysSinceOccurrence, "day")} since</span>}
            <span>{remaining < 0 ? `${plural(Math.abs(remaining), "day")} overdue` : remaining === 0 ? "Due today" : `${plural(remaining, "day")} remaining`}</span>
          </p>
          {onOpen && item.type === "recurring" && history.length > 1 && (
            <div className="history-strip" aria-label="Recent completion cycles">
              {history.slice(0, 5).map((entry, index) => <CycleDonut key={entry.id} current={entry} previous={history[index + 1]} item={item} />)}
            </div>
          )}
        </div>
        <div className="primary-donut">
          <Donut progress={progress} status={status} label={`${Math.round(progress * 100)} percent elapsed, ${remaining < 0 ? "overdue" : `${remaining} days remaining`}`} />
          <div className="donut-details">
            {largerTime && <span className="larger-time">{largerTime}</span>}
            <span className="due-date">{item.source ? formatMonthDayDate(due) : formatDueDate(due)}</span>
            <span className="due-weekday">{formatWeekday(due)}</span>
          </div>
        </div>
    </>
  );
  return (
    <article className={`item-row item-row--${status}`}>
      {onOpen
        ? <button className="item-row__main" onClick={onOpen} aria-label={`Open ${item.title} details`}>{content}</button>
        : <div className="item-row__main item-row__main--static">{content}</div>}
    </article>
  );
}

const emptyDraft = (): TrackedItem => ({
  id: "",
  verb: "",
  title: "",
  type: "recurring",
  intervalValue: 30,
  intervalUnit: "days",
  lastCompleted: toISO(today()),
  reminderDays: 7,
  history: [],
  createdAt: toISO(today()),
});

export default function Home() {
  const [sync] = useState(() => (() => { const transport = new RowTransport(); return new HouseholdSync(transport.read, 350, transport.save.bind(transport)); })());
  const snapshot = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot);
  const { items, ready, status: syncState } = snapshot;
  const setItems = sync.setItems;
  const loadError = !ready && syncState === "error";
  const [currentDay, setCurrentDay] = useState(() => toISO(today()));
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [theme, setTheme] = useState<ThemeId>("light");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"detail" | "edit" | "add">("detail");
  const [draft, setDraft] = useState<TrackedItem>(emptyDraft());
  const [completeDate, setCompleteDate] = useState(toISO(today()));
  const [snoozeMode, setSnoozeMode] = useState<"duration" | "date">("duration");
  const [snoozeValue, setSnoozeValue] = useState(3);
  const [snoozeUnit, setSnoozeUnit] = useState<Unit>("days");
  const [snoozeDate, setSnoozeDate] = useState(toISO(addDays(today(), 7)));
  const [showHistory, setShowHistory] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [holidayName, setHolidayName] = useState("");
  const [holidayDateValue, setHolidayDateValue] = useState(toISO(addDays(today(), 30)));
  const [holidayRule, setHolidayRule] = useState<WeekdayRule>();
  const [celebrationType, setCelebrationType] = useState<"birthday" | "anniversary">("birthday");
  const [celebrationName, setCelebrationName] = useState("");
  const [celebrationDate, setCelebrationDate] = useState(toISO(addDays(today(), 30)));
  const [celebrationNotes, setCelebrationNotes] = useState("");
  const [celebrationSettings, setCelebrationSettings] = useState<Pick<TrackedItem, "showOnDashboard" | "showOnDisplay" | "notifyDueToday" | "showOnMainWithinDays">>({
    showOnDashboard: true, showOnDisplay: true, notifyDueToday: true, showOnMainWithinDays: 60,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<CsvExportKind | null>(null);
  const [exportError, setExportError] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayModeRef = useRef(false);
  const selected = items.find((item) => item.id === selectedId);
  const panelOpen = !!selected || mode === "add";
  const canExport = ready && !readOnly && syncState === "saved" && !snapshot.dirty;

  const closePanel = useCallback(() => {
    // Dismiss the keyboard before removing its field or navigating away.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches("input, select, textarea")) active.blur();
    sync.setDraftOpen(false);
    setSelectedId(null);
    setMode("detail");
    setShowHistory(false);
  }, [sync]);

  useEffect(() => {
    const isDisplayRoute = window.location.pathname === "/display";
    displayModeRef.current = isDisplayRoute;
    const displayModeTimer = window.setTimeout(() => setReadOnly(isDisplayRoute), 0);

    const saved = window.localStorage.getItem("daylapse.theme");
    const savedTheme = THEMES.some((option) => option.id === saved) ? saved as ThemeId : null;
    const initial = isDisplayRoute
      ? "dark-purple"
      : savedTheme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    // This effect hydrates a device-local preference after the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(initial);
    document.documentElement.dataset.theme = initial;

    if (!isDisplayRoute && new URLSearchParams(window.location.search).get("screen") === "notifications") {
      setScreen("notifications");
    }
    return () => window.clearTimeout(displayModeTimer);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    const isDisplay = window.location.pathname === "/display";
    const displayKey = new URLSearchParams(window.location.search).get("display_key");
    sync.start(isDisplay ? `/api/display/items?display_key=${encodeURIComponent(displayKey ?? "")}&timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}` : "/api/events/snapshot", isDisplay);
    return () => sync.stop();
  }, [sync]);

  useEffect(() => {
    const refresh = () => {
      setCurrentDay(toISO(today()));
      // Drafts are not in the save queue until submitted. Keep their base stable.
      if (mode !== "add" && mode !== "edit") void sync.refresh();
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync, mode]);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!sync.getSnapshot().dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [sync]);

  useEffect(() => {
    if (!selected && mode !== "add") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, mode, closePanel]);

  useEffect(() => {
    if (!panelOpen) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const previousOverflow = document.body.style.overflow;

    const updatePanelViewport = () => {
      root.style.setProperty("--panel-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty("--panel-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };

    // Let the browser reveal focused fields itself. A second delayed scroll
    // competes with iOS keyboard scrolling and can move the underlying page.
    document.body.style.overflow = "hidden";
    updatePanelViewport();
    viewport?.addEventListener("resize", updatePanelViewport);
    viewport?.addEventListener("scroll", updatePanelViewport);
    window.addEventListener("orientationchange", updatePanelViewport);

    return () => {
      document.body.style.overflow = previousOverflow;
      viewport?.removeEventListener("resize", updatePanelViewport);
      viewport?.removeEventListener("scroll", updatePanelViewport);
      window.removeEventListener("orientationchange", updatePanelViewport);
      root.style.removeProperty("--panel-viewport-height");
      root.style.removeProperty("--panel-viewport-top");
    };
  }, [panelOpen]);


  const visible = useMemo(() => items
    .filter((item) => isDashboardVisible(item, fromISO(currentDay)))
    .sort((a, b) => dueDate(a, fromISO(currentDay)).getTime() - dueDate(b, fromISO(currentDay)).getTime()), [items, currentDay]);
  const archivedItems = useMemo(() => items
    .filter((item) => item.archived && !item.deletedAt)
    .sort((a, b) => dueDate(a, fromISO(currentDay)).getTime() - dueDate(b, fromISO(currentDay)).getTime()), [items, currentDay]);
  const overdueCount = items.filter((item) => !item.archived && statusFor(item) === "overdue").length;
  const upcomingCount = items.filter((item) => !item.archived && daysBetween(today(), dueDate(item, fromISO(currentDay))) >= 0 && daysBetween(today(), dueDate(item, fromISO(currentDay))) <= 14).length;
  const customHolidays = items.filter((item) => item.source === "holiday" && !item.holidayKey && !item.archived).sort((a, b) => dueDate(a, fromISO(currentDay)).getTime() - dueDate(b, fromISO(currentDay)).getTime());
  const celebrations = items.filter((item) => (item.source === "birthday" || item.source === "anniversary") && !item.archived).sort((a, b) => dueDate(a, fromISO(currentDay)).getTime() - dueDate(b, fromISO(currentDay)).getTime());
  const displayHouseholdItems = useMemo(() => items
    .filter((item) => !item.archived && item.type === "recurring")
    .sort((a, b) => dueDate(a, fromISO(currentDay)).getTime() - dueDate(b, fromISO(currentDay)).getTime())
    .slice(0, DISPLAY_ITEM_LIMIT), [items, currentDay]);
  const displayEventItems = useMemo(() => items
    .filter((item) => !item.archived && item.type === "fixed")
    .sort((a, b) => dueDate(a, fromISO(currentDay)).getTime() - dueDate(b, fromISO(currentDay)).getTime())
    .slice(0, DISPLAY_ITEM_LIMIT), [items, currentDay]);

  async function downloadCsv(kind: CsvExportKind) {
    if (!canExport || exporting || displayModeRef.current) return;
    setExporting(kind);
    setExportError("");
    try {
      const { content, filename } = await fetchCsvExport(kind);
      const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        // Give Safari time to begin reading the file before releasing it.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setMenuOpen(false);
    } catch {
      setExportError("Could not download your CSV. Check your connection and try again.");
    } finally {
      setExporting(null);
    }
  }

  function changeTheme(next: ThemeId) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("daylapse.theme", next);
  }

  function selectScreen(next: Screen) {
    closePanel();
    setMenuOpen(false);
    setScreen(next);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(any-pointer: coarse)").matches ? "instant" : "smooth" });
  }

  function handlePrimaryAdd() {
    if (screen === "dashboard" || screen === "manage") return openAdd();
    if (screen === "notifications") return selectScreen("dashboard");
    const id = screen === "holidays" ? "custom-holiday-form" : "celebration-form";
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function toggleHoliday(definition: HolidayDefinition) {
    const existing = items.find((item) => !item.deletedAt && item.source === "holiday" && item.holidayKey === definition.key);
    if (existing) {
      setItems((all) => all.filter((item) => item.id !== existing.id));
      return;
    }
    setItems((all) => [...all, {
      id: crypto.randomUUID(),
      title: definition.name,
      type: "fixed",
      intervalValue: 1,
      intervalUnit: "years",
      category: "Holiday",
      reminderDays: 30,
      history: [],
      source: "holiday",
      holidayKey: definition.key,
      showOnMainWithinDays: 60,
      createdAt: toISO(today()),
    }]);
  }

  function addCustomHoliday(event: FormEvent) {
    event.preventDefault();
    if (!holidayName.trim() || !holidayDateValue) return;
    setItems((all) => [...all, {
      id: crypto.randomUUID(),
      title: holidayName.trim(),
      type: "fixed",
      intervalValue: 1,
      intervalUnit: "years",
      monthDay: holidayRule ? undefined : holidayDateValue.slice(5),
      weekdayRule: holidayRule,
      category: "Holiday",
      reminderDays: 30,
      history: [],
      source: "holiday",
      showOnMainWithinDays: 60,
      createdAt: toISO(today()),
    }]);
    setHolidayName("");
  }

  function addCelebration(event: FormEvent) {
    event.preventDefault();
    if (!celebrationName.trim() || !celebrationDate) return;
    const isBirthday = celebrationType === "birthday";
    setItems((all) => [...all, {
      id: crypto.randomUUID(),
      title: celebrationName.trim(),
      type: "fixed",
      intervalValue: 1,
      intervalUnit: "years",
      monthDay: celebrationDate.slice(5),
      category: isBirthday ? "Birthday" : "Anniversary",
      notes: celebrationNotes.trim(),
      reminderDays: 30,
      history: [],
      source: celebrationType,
      ...celebrationSettings,
      createdAt: toISO(today()),
    }]);
    setCelebrationName("");
    setCelebrationNotes("");
  }

  function openItem(item: TrackedItem) {
    sync.setDraftOpen(true);
    setSelectedId(item.id);
    setDraft({
      ...structuredClone(item),
      verb: item.source ? undefined : displayVerb(item),
      targetDate: item.source ? annualEditDate(item) : item.targetDate,
    });
    setCompleteDate(toISO(today()));
    setShowHistory(false);
    setMode("detail");
  }

  function openAdd() {
    sync.setDraftOpen(true);
    setDraft(emptyDraft());
    setSelectedId(null);
    setMode("add");
  }


  function completeItem() {
    if (!selected || selected.type !== "recurring") return;
    const entry = { id: crypto.randomUUID(), date: completeDate };
    setItems((all) => all.map((item) => item.id === selected.id ? recordCompletion(item, entry) : item));
    closePanel();
  }

  function applySnooze(value: number, unit: Unit) {
    if (!selected) return;
    const date = addInterval(dueDate(selected), value, unit);
    setItems((all) => all.map((item) => item.id === selected.id ? { ...item, snoozedUntil: toISO(date) } : item));
    closePanel();
  }

  function applyCustomSnooze() {
    if (!selected) return;
    const target = snoozeMode === "date" ? snoozeDate : toISO(addInterval(dueDate(selected), snoozeValue, snoozeUnit));
    setItems((all) => all.map((item) => item.id === selected.id ? { ...item, snoozedUntil: target } : item));
    closePanel();
  }

  function removeSnooze() {
    if (!selected) return;
    setItems((all) => all.map((item) => item.id === selected.id ? { ...item, snoozedUntil: undefined } : item));
    closePanel();
  }

  function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() || (!draft.source && !draft.verb?.trim())) return;
    const cleaned = draft.source
      ? normalizeStoredItem({ ...draft, title: draft.title.trim(), monthDay: draft.targetDate?.slice(5) || draft.monthDay })
      : { ...draft, verb: draft.verb?.trim(), title: draft.title.trim() };
    if (mode === "add") {
      const history = draft.type === "recurring" && draft.lastCompleted ? [{ id: crypto.randomUUID(), date: draft.lastCompleted }] : [];
      setItems((all) => [...all, { ...cleaned, id: crypto.randomUUID(), history, createdAt: toISO(today()) }]);
    } else {
      setItems((all) => all.map((item) => item.id === draft.id ? applyItemEdit(item, cleaned) : item));
    }
    closePanel();
  }

  function archiveSelected() {
    if (!selected) return;
    setItems((all) => all.map((item) => item.id === selected.id ? { ...item, archived: !item.archived } : item));
    closePanel();
  }

  function deleteSelected() {
    if (!selected || !window.confirm(`Delete “${selected.title}”? You can restore it from Manage items.`)) return;
    setItems((all) => all.filter((item) => item.id !== selected.id));
    closePanel();
  }

  function deleteLastCompletion() {
    if (!selected || selected.type !== "recurring" || !selected.lastCompleted) return;
    if (!window.confirm(`Delete the completion recorded on ${formatDate(selected.lastCompleted)}?`)) return;
    setItems((all) => all.map((item) => item.id === selected.id ? removeLatestCompletion(item) : item));
  }

  if (!ready) return (
    <main className="loading-state" aria-live="polite">
      {loadError ? (
        <div className="load-error">
          <strong>Your household data could not be loaded.</strong>
          <span>Nothing has been changed or replaced.</span>
          <button type="button" onClick={() => void sync.retry()}>Try again</button>
        </div>
      ) : "Loading items…"}
    </main>
  );

  if (readOnly) return (
    <main className="app-shell display-shell">
      <header className="display-header">
        <h1>Daylapse</h1>
        {snapshot.message && <p role="status">Saved data could not be refreshed. Retrying automatically.</p>}
      </header>
      <section className="display-board" aria-label="Daylapse household display">
        <section className="display-column" aria-labelledby="display-household-heading">
          <div className="display-column__heading">
            <h2 id="display-household-heading">Household</h2>
          </div>
          <div className="item-list">
            {displayHouseholdItems.map((item) => <ItemRow key={item.id} item={item} />)}
            {displayHouseholdItems.length === 0 && <p className="display-empty">No items to display.</p>}
          </div>
        </section>
        <section className="display-column" aria-labelledby="display-events-heading">
          <div className="display-column__heading">
            <h2 id="display-events-heading">Events</h2>
          </div>
          <div className="item-list">
            {displayEventItems.map((item) => <ItemRow key={item.id} item={item} preserveVerbSpace={!!item.source} />)}
            {displayEventItems.length === 0 && <p className="display-empty">No events are currently scheduled.</p>}
          </div>
        </section>
      </section>
    </main>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-menu" ref={menuRef}>
          <button className="brand" type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-haspopup="menu">
            <span className="brand-mark" />
            <span>Daylapse</span>
            <span className={`brand-chevron ${menuOpen ? "brand-chevron--open" : ""}`} aria-hidden="true">⌄</span>
          </button>
          {menuOpen && (
            <div className="brand-popover" role="menu">
              <button className="menu-link" type="button" role="menuitem" onClick={() => selectScreen("dashboard")}>
                <span><strong>Dashboard</strong><small>View tasks and dates</small></span><b aria-hidden="true">→</b>
              </button>
              {!readOnly && (
                <>
                  <button className="menu-link" type="button" role="menuitem" onClick={() => selectScreen("manage")}>
                    <span><strong>Manage items</strong><small>View hidden, archived, and deleted items</small></span><b aria-hidden="true">→</b>
                  </button>
                  <button className="menu-link" type="button" role="menuitem" onClick={() => selectScreen("notifications")}>
                    <span><strong>Notifications</strong><small>Get alerts for items due today</small></span><b aria-hidden="true">→</b>
                  </button>
                </>
              )}
              {!readOnly && (
                <>
                  <button className="menu-link" type="button" role="menuitem" disabled={!canExport || exporting !== null} onClick={() => void downloadCsv("items")}>
                    <span><strong>{exporting === "items" ? "Preparing items CSV…" : "Download items CSV"}</strong><small>{canExport ? "All items, including archives and next due dates" : "Available when your changes are synced"}</small></span><b aria-hidden="true">↓</b>
                  </button>
                  <button className="menu-link" type="button" role="menuitem" disabled={!canExport || exporting !== null} onClick={() => void downloadCsv("history")}>
                    <span><strong>{exporting === "history" ? "Preparing history CSV…" : "Download history CSV"}</strong><small>{canExport ? "Completion dates for all saved items" : "Available when your changes are synced"}</small></span><b aria-hidden="true">↓</b>
                  </button>
                </>
              )}
              <label className="menu-theme">
                <span><strong>Color</strong><small>Choose a theme</small></span>
                <select value={theme} onChange={(event) => changeTheme(event.target.value as ThemeId)} aria-label="Color theme">
                  {THEMES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
        <div className="topbar__actions">
          <span className={`sync-state sync-state--${syncState}`} role="status">{syncState === "loading" ? "Loading shared data" : syncState === "saving" ? "Saving…" : syncState === "conflict" ? "Needs review" : syncState === "error" ? "Not synced" : "Synced"}</span>
          {!readOnly && (
            <button className="add-button" onClick={handlePrimaryAdd}>
              {screen === "notifications" ? "Done" : <><span aria-hidden="true">＋</span> {screen === "dashboard" ? "Add item" : screen === "holidays" ? "Custom" : "Add date"}</>}
            </button>
          )}
        </div>
      </header>

      {snapshot.message && (
        <section className="sync-message" role="alert">
          <p>{snapshot.message}</p>
          {snapshot.conflicts.length > 0 && <p><strong>{snapshot.conflicts.join(", ")}</strong></p>}
          <div className="sync-message-actions">
            {snapshot.conflicts.length > 0 ? <>
              <button disabled={snapshot.refreshing} onClick={() => void sync.retry("local")}>Keep my edits for these items</button>
              <button disabled={snapshot.refreshing} onClick={() => void sync.retry("remote")}>Use saved edits for these items</button>
            </> : <button disabled={snapshot.refreshing} onClick={() => void sync.retry()}>{snapshot.refreshing ? "Checking…" : "Retry sync"}</button>}
          </div>
        </section>
      )}

      {!readOnly && exportError && <p className="export-error" role="alert">{exportError}</p>}

      {screen !== "notifications" && (
        <nav className="screen-nav" aria-label="Daylapse sections">
          <button className={screen === "dashboard" ? "active" : ""} onClick={() => selectScreen("dashboard")}>Dashboard</button>
          <button className={screen === "holidays" ? "active" : ""} onClick={() => selectScreen("holidays")}>Holidays</button>
          <button className={screen === "celebrations" ? "active" : ""} onClick={() => selectScreen("celebrations")}>Birthdays &amp; Anniversaries</button>
        </nav>
      )}

      {screen === "dashboard" && (
        <>
          <section className="overview" id="top">
            <div>
              <p className="section-kicker">Overview</p>
              <h1>Your household</h1>
              <p className="overview__lede">Upcoming tasks and dates.</p>
            </div>
            <div className="summary" aria-label="Item summary">
              <div><strong>{items.filter((item) => !item.archived).length}</strong><span>Tracked</span></div>
              <div><strong>{upcomingCount}</strong><span>Next 14 days</span></div>
              <div className={overdueCount ? "summary--overdue" : ""}><strong>{overdueCount}</strong><span>Overdue</span></div>
            </div>
          </section>

          <section className="schedule" aria-labelledby="schedule-heading">
            <div className="schedule-heading">
              <h2 id="schedule-heading">Coming up</h2>
              <span>{visible.length} {visible.length === 1 ? "item" : "items"} · soonest first</span>
            </div>
            <div className="item-list">
              {visible.map((item) => <ItemRow key={item.id} item={item} preserveVerbSpace={!!item.source} onOpen={() => openItem(item)} />)}
              {visible.length === 0 && (
                <div className="empty-state">
                  <span className="empty-orbit" aria-hidden="true" />
                  <h3>Nothing coming up</h3>
                  <p>{readOnly ? "No items to display." : "Add a task or date to track."}</p>
                  {!readOnly && <button className="add-button" onClick={openAdd}>Add an item</button>}
                </div>
              )}
              <div className="archive-section">
                <button className="archive-toggle" onClick={() => setArchivedOpen(!archivedOpen)} aria-expanded={archivedOpen} aria-controls="archived-items">
                  <span>Archived</span>
                  <span>{archivedItems.length} {archivedItems.length === 1 ? "item" : "items"} <b aria-hidden="true">{archivedOpen ? "−" : "+"}</b></span>
                </button>
                {archivedOpen && (
                  <div className="archive-items" id="archived-items">
                    {archivedItems.map((item) => <ItemRow key={item.id} item={item} preserveVerbSpace={!!item.source} onOpen={() => openItem(item)} />)}
                    {archivedItems.length === 0 && <p className="archive-empty">No archived items.</p>}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {screen === "holidays" && (
        <>
          <section className="overview overview--screen" id="top">
            <div><h1>Holidays</h1><p className="overview__lede">Choose the holidays you observe.</p></div>
          </section>
          <section className="screen-content" aria-labelledby="holiday-list-heading">
            <div className="schedule-heading"><h2 id="holiday-list-heading">Select holidays</h2><span>{items.filter((item) => item.source === "holiday" && item.holidayKey).length} selected</span></div>
            <div className="holiday-grid">
              {HOLIDAYS.map((holiday) => {
                const selectedHoliday = items.some((item) => item.source === "holiday" && item.holidayKey === holiday.key);
                const nextDate = nextHolidayDate(holiday.key, fromISO(currentDay));
                const daysUntil = daysBetween(fromISO(currentDay), nextDate);
                const holidayItem = items.find((item) => item.source === "holiday" && item.holidayKey === holiday.key);
                const currentYearDate = holidayDate(holiday.key, today().getFullYear());
                const previousDate = currentYearDate > today() ? holidayDate(holiday.key, today().getFullYear() - 1) : currentYearDate;
                const daysSince = holidayItem ? daysBetween(previousAnnualDate(holidayItem), today()) : daysBetween(previousDate, today());
                return (
                  <button key={holiday.key} className={`holiday-option ${selectedHoliday ? "selected" : ""}`} onClick={readOnly ? undefined : () => toggleHoliday(holiday)} role="switch" aria-checked={selectedHoliday} aria-disabled={readOnly}>
                    <span><strong>{holiday.name}</strong><small>{holiday.note} · {daysUntil === 0 ? "Today" : `${plural(daysUntil, "day")} until`} · {plural(daysSince, "day")} since · next {formatDate(toISO(nextDate), true)}</small></span>
                    <b aria-hidden="true">{selectedHoliday ? "✓" : "+"}</b>
                  </button>
                );
              })}
            </div>
            <div className="subsection-heading"><div><h2>Custom holidays</h2></div><span>{customHolidays.length}</span></div>
            {customHolidays.map((item) => <ItemRow key={item.id} item={item} onOpen={() => openItem(item)} />)}
            {!readOnly && (
              <form className="inline-form" id="custom-holiday-form" onSubmit={addCustomHoliday}>
                <div><h3>Add holiday</h3></div>
                <label>Name<input required value={holidayName} onChange={(e) => setHolidayName(e.target.value)} placeholder="e.g. Family reunion" /></label>
                <HolidayScheduleFields date={holidayDateValue} rule={holidayRule} onChange={(date, rule) => { setHolidayDateValue(date); setHolidayRule(rule); }} />
                <button className="primary-action" type="submit">Add holiday</button>
              </form>
            )}
          </section>
        </>
      )}

      {screen === "celebrations" && (
        <>
          <section className="overview overview--screen" id="top">
            <div><h1>Birthdays &amp; Anniversaries</h1></div>
          </section>
          <section className="screen-content" aria-labelledby="celebration-list-heading">
            {!readOnly && (
              <form className="inline-form inline-form--celebration" id="celebration-form" onSubmit={addCelebration}>
                <div><h3>Add date</h3></div>
                <label>Type<select value={celebrationType} onChange={(e) => setCelebrationType(e.target.value as "birthday" | "anniversary")}><option value="birthday">Birthday</option><option value="anniversary">Anniversary</option></select></label>
                <label>Name<input required value={celebrationName} onChange={(e) => setCelebrationName(e.target.value)} placeholder={celebrationType === "birthday" ? "e.g. A friend’s birthday" : "e.g. Our anniversary"} /></label>
                <label>Month and day <span>Year is not saved</span><input required type="date" value={celebrationDate} onChange={(e) => setCelebrationDate(e.target.value)} /></label>
                <fieldset><legend>Visibility and notifications</legend>
                  <label className="check-label"><input type="checkbox" checked={celebrationSettings.showOnDashboard !== false} onChange={(e) => setCelebrationSettings({...celebrationSettings,showOnDashboard:e.target.checked})} /> Show on dashboard</label>
                  <label className="check-label"><input type="checkbox" checked={celebrationSettings.showOnDisplay !== false} onChange={(e) => setCelebrationSettings({...celebrationSettings,showOnDisplay:e.target.checked})} /> Show on DAKboard</label>
                  <label className="check-label"><input type="checkbox" checked={celebrationSettings.notifyDueToday !== false} onChange={(e) => setCelebrationSettings({...celebrationSettings,notifyDueToday:e.target.checked})} /> Include in due-today notifications</label>
                  <label>Dashboard window (days)<input type="number" min="0" max="3650" placeholder="No limit" value={celebrationSettings.showOnMainWithinDays ?? ""} onChange={(e) => setCelebrationSettings({...celebrationSettings,showOnMainWithinDays:e.target.value === "" ? null : Number(e.target.value)})} /></label>
                </fieldset>
                <label>Notes <span>Optional</span><input value={celebrationNotes} onChange={(e) => setCelebrationNotes(e.target.value)} placeholder="Gift ideas or plans" /></label>
                <button className="primary-action" type="submit">Add date</button>
              </form>
            )}
            <div className="schedule-heading"><h2 id="celebration-list-heading">Birthdays &amp; Anniversaries</h2><span>{celebrations.length} saved</span></div>
            <div className="item-list celebration-list">
              {celebrations.map((item) => <ItemRow key={item.id} item={item} onOpen={() => openItem(item)} />)}
              {celebrations.length === 0 && <div className="compact-empty"><p>No birthdays or anniversaries yet.</p></div>}
            </div>
          </section>
        </>
      )}

      {screen === "manage" && <section className="screen-content"><h1>Manage items</h1><p>All items, including hidden, archived, and deleted items.</p>
        {items.map((item) => <div key={item.id}>{item.deletedAt ? <div className="danger-row"><span>{item.title} · Deleted</span><button disabled={snapshot.dirty} onClick={() => setItems((all) => all.map((i) => i.id === item.id ? {...i,deletedAt:null,archived:false} : i))}>Restore deleted item</button></div> : <><ItemRow item={item} onOpen={() => openItem(item)} /><p>{item.archived ? "Archived · " : ""}Dashboard: {item.showOnDashboard === false ? "hidden" : "enabled"} · DAKboard: {item.showOnDisplay === false ? "hidden" : "enabled"} · Due-today alerts: {item.notifyDueToday === false ? "off" : "on"}</p></>}</div>)}
      </section>}
      {screen === "notifications" && <NotificationsPanel />}

      {(selected || mode === "add") && (
        <div className="panel-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closePanel()}>
          <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
            <button className="close-button" onClick={closePanel} aria-label="Close panel">×</button>
            {mode === "detail" && selected && (
              <>
                <div className="panel-heading">
                  <p className="section-kicker">{selected.category || (selected.type === "fixed" ? "Countdown" : "Household")}</p>
                  <h2 id="panel-title">{selected.title}</h2>
                  <p>{selected.type === "recurring" ? `Repeats every ${selected.intervalValue} ${selected.intervalUnit}` : `${selected.source ? "Next date" : "Target date"} ${selected.source ? formatMonthDayDate(dueDate(selected)) : formatDueDate(dueDate(selected))}`}</p>
                </div>
                {selected.notes && <p className="notes">{selected.notes}</p>}
                {!readOnly && selected.type === "recurring" && (
                  <>
                    <div className="action-block action-block--complete">
                      <div><h3>Mark complete</h3><p>The next interval starts from your most recent completion. Earlier dates add to history.</p></div>
                      <input type="date" value={completeDate} max={toISO(today())} onChange={(e) => setCompleteDate(e.target.value)} aria-label="Completion date" />
                      <button className="primary-action" onClick={completeItem}>Complete</button>
                      {selected.lastCompleted && <button className="undo-completion" onClick={deleteLastCompletion}>Delete last completion · {formatDate(selected.lastCompleted)}</button>}
                    </div>
                    <div className="action-block">
                      <div><h3>Snooze current due date</h3><p>History and last completion stay unchanged.</p></div>
                      <div className="quick-actions">
                        <button onClick={() => applySnooze(1, "days")}>1 day</button>
                        <button onClick={() => applySnooze(1, "weeks")}>1 week</button>
                        <button onClick={() => applySnooze(1, "months")}>1 month</button>
                      </div>
                      <div className="custom-snooze">
                        <select value={snoozeMode} onChange={(e) => setSnoozeMode(e.target.value as "duration" | "date")} aria-label="Custom snooze type"><option value="duration">Custom duration</option><option value="date">Custom date</option></select>
                        {snoozeMode === "duration" ? <><input type="number" min="1" value={snoozeValue} onChange={(e) => setSnoozeValue(Number(e.target.value))} aria-label="Snooze amount" /><select value={snoozeUnit} onChange={(e) => setSnoozeUnit(e.target.value as Unit)} aria-label="Snooze unit"><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option><option value="years">years</option></select></> : <input type="date" value={snoozeDate} min={toISO(today())} onChange={(e) => setSnoozeDate(e.target.value)} aria-label="Snooze until date" />}
                        <button onClick={applyCustomSnooze}>Apply</button>
                      </div>
                      {selected.snoozedUntil && <button className="undo-snooze" onClick={removeSnooze}>Undo snooze to {formatDate(selected.snoozedUntil)}</button>}
                    </div>
                  </>
                )}
                <div className="panel-links">
                  {!readOnly && (
                    <button onClick={() => {
                      setDraft({
                        ...structuredClone(selected),
                        verb: selected.source ? undefined : displayVerb(selected),
                        targetDate: selected.source ? annualEditDate(selected) : selected.targetDate,
                      });
                      setMode("edit");
                    }}>Edit item <span>→</span></button>
                  )}
                  {selected.type === "recurring" && <button onClick={() => setShowHistory(!showHistory)}>Full completion history <span>{showHistory ? "↑" : "↓"}</span></button>}
                </div>
                {showHistory && selected.type === "recurring" && (
                  <CompletionHistory eventId={selected.id} />
                )}
                {!readOnly && <div className="danger-row"><button onClick={archiveSelected}>{selected.archived ? "Restore item" : "Archive item"}</button><button onClick={deleteSelected}>Delete</button></div>}
              </>
            )}

            {!readOnly && (mode === "add" || mode === "edit") && (
              <form onSubmit={saveDraft} className="item-form">
                <div className="panel-heading"><h2 id="panel-title">{mode === "add" ? "Add an item" : `Edit ${draft.title}`}</h2></div>
                {!draft.source && <label>Verb<input required value={draft.verb || ""} onChange={(e) => setDraft({ ...draft, verb: e.target.value })} placeholder="e.g. Clean" /></label>}
                <label>{draft.source ? "Name" : "Object / noun"}<input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={draft.source ? "Celebration name" : "e.g. Dryer vent"} /></label>
                {!draft.source && <fieldset><legend>Item type</legend><div className="segmented"><button type="button" className={draft.type === "recurring" ? "active" : ""} onClick={() => setDraft({ ...draft, type: "recurring" })}>Recurring interval</button><button type="button" className={draft.type === "fixed" ? "active" : ""} onClick={() => setDraft({ ...draft, type: "fixed" })}>Fixed date</button></div></fieldset>}
                {draft.type === "recurring" ? (
                  <>
                    <fieldset><legend>Repeat every</legend><div className="field-pair"><input type="number" min="1" required value={draft.intervalValue} onChange={(e) => setDraft({ ...draft, intervalValue: Number(e.target.value) })} aria-label="Interval amount" /><select value={draft.intervalUnit} onChange={(e) => setDraft({ ...draft, intervalUnit: e.target.value as Unit })} aria-label="Interval unit"><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option><option value="years">years</option></select></div></fieldset>
                    <label>Last completed<input type="date" required value={draft.lastCompleted} max={toISO(today())} onChange={(e) => setDraft({ ...draft, lastCompleted: e.target.value })} /></label>
                  </>
                ) : draft.source ? (
                  draft.holidayKey
                    ? <label>Month and day <span>Set by the holiday calendar</span><input value={formatMonthDayDate(dueDate(draft))} disabled /></label>
                    : draft.source === "holiday" ? <HolidayScheduleFields date={draft.targetDate || "2000-01-01"} rule={draft.weekdayRule} onChange={(date, rule) => setDraft({ ...draft, weekdayRule: rule, targetDate: rule ? undefined : date, monthDay: rule ? undefined : date.slice(5) })} />
                    : <label>Month and day <span>Year is not saved</span><input type="date" required value={draft.targetDate || ""} onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })} /></label>
                ) : (
                  <><label>Target date<input type="date" required value={draft.targetDate || ""} onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })} /></label><label className="check-label"><input type="checkbox" checked={!!draft.annual} onChange={(e) => setDraft({ ...draft, annual: e.target.checked })} /> Repeat annually</label></>
                )}
                <div className="field-pair"><label>Category <span>Optional</span><input value={draft.category || ""} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Home systems" /></label><label>Highlight when<input type="number" min="0" value={draft.reminderDays} onChange={(e) => setDraft({ ...draft, reminderDays: Number(e.target.value) })} /><small>days remain</small></label></div>
                <fieldset><legend>Visibility and notifications</legend>
                  <label className="check-label"><input type="checkbox" checked={draft.showOnDashboard !== false} onChange={(e) => setDraft({...draft,showOnDashboard:e.target.checked})} /> Show on dashboard</label>
                  <label className="check-label"><input type="checkbox" checked={draft.showOnDisplay !== false} onChange={(e) => setDraft({...draft,showOnDisplay:e.target.checked})} /> Show on DAKboard</label>
                  <label className="check-label"><input type="checkbox" checked={draft.notifyDueToday !== false} onChange={(e) => setDraft({...draft,notifyDueToday:e.target.checked})} /> Include in due-today notifications</label>
                  <label>Dashboard window (days)<input type="number" min="0" max="3650" placeholder="No limit" value={draft.showOnMainWithinDays ?? ""} onChange={(e) => setDraft({...draft,showOnMainWithinDays:e.target.value === "" ? null : Number(e.target.value)})} /></label>
                </fieldset>
                <label>Notes <span>Optional</span><textarea value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Model numbers, supplies, or reminders" /></label>
                <div className="form-actions"><button type="button" onClick={mode === "edit" ? () => setMode("detail") : closePanel}>Cancel</button><button className="primary-action" type="submit">{mode === "add" ? "Add item" : "Save changes"}</button></div>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
