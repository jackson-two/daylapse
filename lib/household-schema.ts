import { z } from "zod";
import { maxWeekdayOccurrence } from "./holiday-rules";

export const MAX_HOUSEHOLD_BODY_BYTES = 1_048_576;
export const MAX_HOUSEHOLD_ITEMS = 500;
export const MAX_HISTORY_ENTRIES_PER_ITEM = 2_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAY = /^(\d{2})-(\d{2})$/;

const strictIdentifier = z.string()
  .min(1, "Must not be empty.")
  .max(128, "Must be at most 128 characters.")
  .refine((value) => value === value.trim(), "Must not have leading or trailing whitespace.");

const boundedText = (maximum: number) => z.string()
  .max(maximum, `Must be at most ${maximum} characters.`);

const holidayKeySchema = z.enum([
  "new-year",
  "mlk-day",
  "valentines",
  "presidents-day",
  "memorial-day",
  "independence-day",
  "labor-day",
  "halloween",
  "thanksgiving",
  "christmas",
]);

function isValidIsoDate(value: string) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidMonthDay(value: string) {
  const match = MONTH_DAY.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= new Date(Date.UTC(2000, month, 0)).getUTCDate();
}

const isoDateSchema = z.string().refine(isValidIsoDate, "Expected a valid YYYY-MM-DD date.");
const monthDaySchema = z.string().refine(isValidMonthDay, "Expected a valid MM-DD date.");

export const historyEntrySchema = z.strictObject({
  id: strictIdentifier,
  date: isoDateSchema,
});

export const weekdayRuleSchema = z.strictObject({
  month: z.number().int().min(1).max(12),
  weekday: z.number().int().min(0).max(6),
  occurrence: z.number().int().min(1).max(5),
  afterFullWeek: z.boolean().default(false),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(0),
}).refine((rule) => rule.occurrence <= maxWeekdayOccurrence(rule),
  "This weekday occurrence cannot fit within the selected month.");
export type WeekdayRule = z.infer<typeof weekdayRuleSchema>;

export const trackedItemSchema = z.strictObject({
  id: strictIdentifier,
  verb: boundedText(80).optional(),
  title: boundedText(200).refine((value) => value.trim().length > 0, "Must not be empty."),
  type: z.enum(["recurring", "fixed"]),
  intervalValue: z.number().int().min(1).max(10_000),
  intervalUnit: z.enum(["days", "weeks", "months", "years"]),
  lastCompleted: isoDateSchema.optional(),
  targetDate: isoDateSchema.optional(),
  monthDay: monthDaySchema.optional(),
  annual: z.boolean().optional(),
  category: boundedText(80).optional(),
  notes: boundedText(10_000).optional(),
  reminderDays: z.number().int().min(0).max(3_650),
  history: z.array(historyEntrySchema).max(MAX_HISTORY_ENTRIES_PER_ITEM),
  snoozedUntil: isoDateSchema.optional(),
  archived: z.boolean().optional(),
  source: z.enum(["holiday", "birthday", "anniversary"]).optional(),
  holidayKey: holidayKeySchema.optional(),
  weekdayRule: weekdayRuleSchema.optional(),
  showOnMainWithinDays: z.number().int().min(0).max(3_650).nullable().optional(),
  showOnDashboard: z.boolean().optional(),
  showOnDisplay: z.boolean().optional(),
  notifyDueToday: z.boolean().optional(),
  deletedAt: z.string().nullable().optional(),
  completionCount: z.number().int().nonnegative().optional(),
  createdAt: isoDateSchema,
}).superRefine((item, context) => {
  if (item.type === "fixed" && !item.source && !item.targetDate) {
    context.addIssue({
      code: "custom",
      path: ["targetDate"],
      message: "A fixed one-time item requires a target date.",
    });
  }

  if (item.source && item.type !== "fixed") {
    context.addIssue({
      code: "custom",
      path: ["type"],
      message: "A holiday, birthday, or anniversary must be a fixed item.",
    });
  }

  if (item.source && !item.holidayKey && !item.weekdayRule && !item.monthDay) {
    context.addIssue({
      code: "custom",
      path: ["monthDay"],
      message: "A custom holiday, birthday, or anniversary requires a month and day.",
    });
  }

  if (item.holidayKey && item.source !== "holiday") {
    context.addIssue({
      code: "custom",
      path: ["holidayKey"],
      message: "A holiday key may only be used by a holiday item.",
    });
  }

  if (item.weekdayRule && (item.source !== "holiday" || item.holidayKey || item.monthDay || item.targetDate || item.annual)) {
    context.addIssue({ code: "custom", path: ["weekdayRule"], message: "A weekday rule must be the holiday's only date rule." });
  }

  const historyIds = new Set<string>();
  item.history.forEach((entry, index) => {
    if (historyIds.has(entry.id)) {
      context.addIssue({
        code: "custom",
        path: ["history", index, "id"],
        message: "History entry IDs must be unique within an item.",
      });
    }
    historyIds.add(entry.id);
  });
});

export const householdItemsSchema = z.array(trackedItemSchema)
  .max(MAX_HOUSEHOLD_ITEMS)
  .superRefine((items, context) => {
    const itemIds = new Set<string>();
    items.forEach((item, index) => {
      if (itemIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Item IDs must be unique within the household.",
        });
      }
      itemIds.add(item.id);
    });
  });

export const saveHouseholdRequestSchema = z.strictObject({
  items: householdItemsSchema,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const restoreHouseholdRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export type Unit = z.infer<typeof trackedItemSchema>["intervalUnit"];
export type ItemType = z.infer<typeof trackedItemSchema>["type"];
export type CelebrationSource = NonNullable<z.infer<typeof trackedItemSchema>["source"]>;
export type HolidayKey = z.infer<typeof holidayKeySchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type TrackedItem = z.infer<typeof trackedItemSchema>;
export type SaveHouseholdRequest = z.infer<typeof saveHouseholdRequestSchema>;
export type RestoreHouseholdRequest = z.infer<typeof restoreHouseholdRequestSchema>;

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export function validationIssues(error: z.ZodError, root = "items"): ValidationIssue[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path.reduce<string>(
      (result, part) => typeof part === "number" ? `${result}[${part}]` : `${result}.${String(part)}`,
      root,
    );
    return { path, code: issue.code, message: issue.message };
  });
}
