import { z } from "zod";

export const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().trim().max(2000).default("");
const name = z.string().trim().min(1).max(160);
const optionalId = id.nullable().default(null);
const url = z
  .union([
    z.literal(""),
    z.url().refine((v) => new URL(v).protocol === "https:", "Use an HTTPS URL"),
  ])
  .default("");
export const instant = z.iso
  .datetime({ offset: true })
  .overwrite((value) => new Date(value).toISOString());
export const money = z.number().int().min(0).max(1_000_000_000);
export const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((v) => {
    try {
      return Intl.supportedValuesOf("currency").includes(v);
    } catch {
      return false;
    }
  }, "Use an ISO currency code")
  .default("USD");
export const units = [
  "each",
  "can",
  "sheet",
  "g",
  "kg",
  "oz",
  "lb",
  "ml",
  "l",
  "fl oz",
] as const;
export const packageAmount = z.number().positive().max(1_000_000);
export const packages = z.number().int().min(0).max(10_000);
export const entityNames = [
  "items",
  "products",
  "stores",
  "locations",
  "offerings",
] as const;
export const entityName = z.enum(entityNames);
export type EntityName = z.infer<typeof entityName>;
export const fields = {
  items: z.strictObject({
    name,
    category: text,
    notes: text,
    imageUrl: url,
    defaultUnit: text,
  }),
  products: z.strictObject({
    itemId: id,
    name,
    brand: text,
    packageQuantity: packageAmount,
    packageUnit: z.enum(units),
    upc: z.string().max(32).default(""),
    sku: text,
    imageUrl: url,
    preference: z.number().int().min(0).max(1000).default(0),
  }),
  stores: z.strictObject({
    name,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#657b70"),
    logoUrl: url,
    website: url,
    notes: text,
  }),
  locations: z.strictObject({
    storeId: id,
    name,
    address: text,
    city: text,
    region: text,
    postalCode: text,
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    storeIdentifier: text,
    preferred: z.boolean().default(false),
  }),
  offerings: z.strictObject({
    productId: id,
    storeId: id,
    locationId: optionalId,
    preference: z.number().int().min(0).max(1000).default(0),
    url,
    notes: text,
  }),
};
export const metadata = z.object({
  id,
  version: z.number().int().positive(),
  createdAt: instant,
  updatedAt: instant,
  archivedAt: instant.nullable(),
});
export type ShopRecord = z.infer<typeof metadata> & Record<string, unknown>;
export const priceFields = z.strictObject({
  offeringId: id,
  locationId: optionalId,
  amount: money,
  currency,
  observedAt: instant,
  source: z.enum([
    "manual",
    "retailer",
    "research",
    "receipt",
    "purchase",
    "import",
  ]),
  sourceUrl: url,
  reference: text,
  verified: z.boolean().default(false),
  conditions: text,
  expiresAt: instant.nullable().default(null),
  notes: text,
});
export const outcomeFields = z
  .strictObject({
    entryId: id,
    offeringId: id,
    locationId: optionalId,
    kind: z.enum(["purchased", "out_of_stock", "skipped"]),
    quantity: packages.default(0),
    packagePrice: money.nullable().default(null),
    totalPrice: money.nullable().default(null),
    currency,
    occurredAt: instant,
    notes: text,
    tripId: optionalId,
    keepOnList: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "purchased" && v.quantity < 1)
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Purchased quantity must be at least one package",
      });
    if (
      v.kind !== "purchased" &&
      (v.quantity !== 0 || v.packagePrice !== null || v.totalPrice !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Only purchases have quantities and paid prices",
      });
    if (
      v.packagePrice !== null &&
      v.totalPrice !== null &&
      v.totalPrice !== v.packagePrice * v.quantity
    )
      ctx.addIssue({
        code: "custom",
        path: ["totalPrice"],
        message:
          "Total must equal package price times quantity; use total only for discounts",
      });
  });
const mutation = {
  mutationId: id,
  expectedVersion: z.number().int().nonnegative(),
};
export const commandSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...mutation,
    operation: z.literal("save"),
    entity: entityName,
    id,
    data: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    ...mutation,
    operation: z.literal("archive"),
    entity: entityName,
    id,
    archived: z.boolean(),
  }),
  z.strictObject({
    ...mutation,
    operation: z.literal("merge"),
    id,
    targetId: id,
    targetVersion: z.number().int().positive(),
  }),
  z.strictObject({
    ...mutation,
    operation: z.literal("list"),
    itemId: id,
    action: z.enum(["add", "remove", "complete", "reactivate", "update"]),
    notes: z.string().trim().max(2000).optional(),
    priority: z.number().int().min(0).max(3).optional(),
    sortPosition: z.number().int().min(0).max(100000).optional(),
  }),
  z.strictObject({
    ...mutation,
    operation: z.literal("quantity"),
    entryId: id,
    offeringId: id,
    quantity: packages,
  }),
  z.strictObject({
    ...mutation,
    operation: z.literal("outcome"),
    data: outcomeFields,
  }),
  z.strictObject({
    ...mutation,
    operation: z.literal("correct"),
    id,
    entryVersion: z.number().int().positive(),
    reason: name,
    replacement: outcomeFields.nullable(),
    reactivate: z.boolean().default(false),
  }),
  z.strictObject({
    ...mutation,
    operation: z.literal("price"),
    data: priceFields,
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export const querySchema = z.strictObject({
  view: z
    .enum([
      "snapshot",
      "list",
      "items",
      "item",
      "stores",
      "history",
      "prices",
      "summary",
      "priceSummary",
      "audit",
      "export",
    ])
    .default("snapshot"),
  id: id.optional(),
  itemId: id.optional(),
  productId: id.optional(),
  storeId: id.optional(),
  locationId: id.optional(),
  offeringId: id.optional(),
  tripId: id.optional(),
  from: instant.optional(),
  to: instant.optional(),
  search: z.string().max(160).default(""),
  includeArchived: z.boolean().default(false),
  includeReversed: z.boolean().default(false),
  after: z.string().max(200).default(""),
  revision: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type Query = z.infer<typeof querySchema>;
export type Context = {
  actor: string;
  source: "user" | "api" | "mcp";
  permission: "read" | "write";
};
export class ShoppingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly current?: unknown,
  ) {
    super(message);
  }
}
export const scalar = (row: Record<string, unknown>, key: string) =>
  String(row[key] ?? "");
export const numeric = (row: Record<string, unknown>, key: string) =>
  Number(row[key] ?? 0);

// Different dimensions are never compared (e.g. mass vs volume vs can count).
const conversion: Record<string, [string, number]> = {
  each: ["each", 1],
  can: ["can", 1],
  sheet: ["sheet", 1],
  g: ["g", 1],
  kg: ["g", 1000],
  oz: ["g", 28.349523125],
  lb: ["g", 453.59237],
  ml: ["ml", 1],
  l: ["ml", 1000],
  "fl oz": ["ml", 29.5735295625],
};
export function unitPrice(amount: number, quantity: number, unit: string) {
  const basis = conversion[unit];
  return basis && quantity > 0
    ? { amount: amount / (quantity * basis[1]), unit: basis[0] }
    : null;
}
export function priceStatus(
  price: Record<string, unknown> | undefined,
  now = Date.now(),
) {
  if (!price) return "Unknown price";
  const days = Math.floor(
    (now - Date.parse(String(price.observedAt))) / 86400000,
  );
  const age = Number.isFinite(days)
    ? days <= 0
      ? "Observed today"
      : `Observed ${days} day${days === 1 ? "" : "s"} ago`
    : "";
  const status =
    price.expiresAt && Date.parse(String(price.expiresAt)) <= now
      ? "Expired observation"
      : !price.verified
        ? "Needs verification"
        : "";
  return [status, age].filter(Boolean).join(" · ");
}
