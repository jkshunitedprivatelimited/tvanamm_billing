import { z } from 'zod';
export const chefItemInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter an item name').max(160),
    category: z.string().trim().min(1, 'Enter a category').max(120),
  })
  .strict();
const text = z.string().trim().max(3000);
const quantity = z
  .string()
  .trim()
  .max(30)
  .refine(
    (v) => v === '' || (/^\d+(\.\d+)?$/.test(v) && Number(v) > 0 && Number(v) <= 1000000),
    'Use a positive measured quantity',
  );
/** One TVANAMM-supplied item (or milk) used in one serving. */
export const chefStockLineSchema = z
  .object({
    item: z.string().trim().max(160),
    quantity,
    unit: z.enum(['g', 'ml', 'pieces']),
    confirmed: z.boolean(),
  })
  .strict();
export const chefStockCheckSchema = z
  .object({
    lines: z.array(chefStockLineSchema).max(30),
    container: z.string().trim().max(160),
    confirmed: z.boolean(),
  })
  .strict();
export type ChefStockLine = z.infer<typeof chefStockLineSchema>;
export type ChefStockCheck = z.infer<typeof chefStockCheckSchema>;

export const chefDraftSchema = z
  .object({
    chefName: z.string().trim().max(120),
    basis: z.enum(['serving', 'batch']),
    servingQuantity: quantity,
    servingUnit: z.enum(['ml', 'g', 'pieces', 'scoops']),
    portionName: z.string().trim().max(100),
    batchYield: quantity,
    batchUnit: z.enum(['ml', 'g', 'pieces', 'scoops']),
    servingsPerBatch: quantity,
    ingredients: z
      .array(
        z
          .object({
            name: z.string().trim().max(160),
            quantity,
            unit: z.enum(['g', 'ml', 'pieces', 'scoops']),
            note: z.string().trim().max(250),
          })
          .strict(),
      )
      .max(60),
    method: text,
    packaging: text,
    measurements: text,
    variations: text,
    questions: text,
    status: z.enum(['draft', 'ready']),
    /** Chef-confirmed TVANAMM items and milk taken from stock for ONE serving. */
    stock: chefStockCheckSchema.optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.status !== 'ready') return;
    const missing =
      !d.chefName ||
      !d.servingQuantity ||
      !d.method ||
      !d.packaging ||
      !d.ingredients.length ||
      d.ingredients.some((i) => !i.name || !i.quantity) ||
      (d.basis === 'batch' && (!d.batchYield || !d.servingsPerBatch));
    if (missing)
      ctx.addIssue({
        code: 'custom',
        message:
          'Complete the chef name, serving size, ingredients, method and packaging. Batch recipes also need a finished yield and servings per batch.',
      });
    if (d.questions)
      ctx.addIssue({
        code: 'custom',
        message: 'Resolve the open questions before marking this recipe ready.',
      });
  });
export type ChefDraft = z.infer<typeof chefDraftSchema>;
export interface ChefItem {
  id: string;
  name: string;
  category: string;
}
export interface ChefEntry {
  itemId: string;
  draft: ChefDraft;
  revision: number;
}
export interface ChefCollection {
  id: string;
  title: string;
  menu: ChefItem[];
  entries: ChefEntry[];
  expiresAt: string;
  closed: boolean;
  submitted: boolean;
}
export const emptyChefDraft = (): ChefDraft => ({
  chefName: '',
  basis: 'serving',
  servingQuantity: '',
  servingUnit: 'ml',
  portionName: 'Regular',
  batchYield: '',
  batchUnit: 'ml',
  servingsPerBatch: '',
  ingredients: [{ name: '', quantity: '', unit: 'g', note: '' }],
  method: '',
  packaging: '',
  measurements: '',
  variations: '',
  questions: '',
  status: 'draft',
});

export type PosRecipeHelp =
  | { status: 'missing' | 'not_ready' }
  | { status: 'ready'; draft: ChefDraft; revision: number; updatedAt: string };

/** TVANAMM-supplied items tracked in Stock (names match Stock exactly), plus milk.
 *  `unit` is how one serving is measured: crushes and ice cream in ml. */
export const TVANAMM_STOCK_ITEMS: readonly { name: string; unit: 'g' | 'ml' | 'pieces' }[] = [
  { name: 'Black Current Crush', unit: 'ml' },
  { name: 'Blue Berry Syrup', unit: 'ml' },
  { name: 'Blue Curraco Syrup', unit: 'ml' },
  { name: 'Chocolate Syrup', unit: 'ml' },
  { name: 'Kiwi Crush', unit: 'ml' },
  { name: 'Lime & Mint Syrup', unit: 'ml' },
  { name: 'Lime &Ginger Syrup', unit: 'ml' },
  { name: 'Litchi Crush', unit: 'ml' },
  { name: 'Mango Crush', unit: 'ml' },
  { name: 'Nannari Crush', unit: 'ml' },
  { name: 'Orange Crush Syrup', unit: 'ml' },
  { name: 'Pine Apple Crush', unit: 'ml' },
  { name: 'Rasberry Syrup', unit: 'ml' },
  { name: 'Rose Red Syrup', unit: 'ml' },
  { name: 'Strawberry Crush', unit: 'ml' },
  { name: 'Banana Crush', unit: 'ml' },
  { name: 'Mixed Fruit Crush', unit: 'ml' },
  { name: 'Osmania Biscuit', unit: 'pieces' },
  { name: 'Blue Pea', unit: 'g' },
  { name: 'Chamomile', unit: 'g' },
  { name: 'Green Tea', unit: 'g' },
  { name: 'Hibiscus', unit: 'g' },
  { name: 'Jasmine', unit: 'g' },
  { name: 'Lavendor', unit: 'g' },
  { name: 'Lemon Grass', unit: 'g' },
  { name: 'Oolong', unit: 'g' },
  { name: 'Pepper Mint Tea', unit: 'g' },
  { name: 'Rose Tea Petals', unit: 'g' },
  { name: 'A.D.F Ice Cream', unit: 'ml' },
  { name: 'Black Current Ice Cream', unit: 'ml' },
  { name: 'Butter Scotch Ice Cream', unit: 'ml' },
  { name: 'Caramel Nuts Ice Cream', unit: 'ml' },
  { name: 'Chocolate Ice Cream', unit: 'ml' },
  { name: 'Strawberry Ice Cream', unit: 'ml' },
  { name: 'Vanilla Ice Cream', unit: 'ml' },
  { name: 'Butter Scotch Coffee', unit: 'g' },
  { name: 'Caramel Coffee', unit: 'g' },
  { name: 'Hazel Nut Coffee', unit: 'g' },
  { name: 'Filter Coffee', unit: 'g' },
  { name: 'Vanilla Coffee', unit: 'g' },
  { name: 'Badam Powder', unit: 'g' },
  { name: 'Bellam Powder', unit: 'g' },
  { name: 'Coffee Powder', unit: 'g' },
  { name: 'Elachi Powder', unit: 'g' },
  { name: 'Kadak Masala', unit: 'g' },
  { name: 'Rose Powder', unit: 'g' },
  { name: 'Sonti Powder', unit: 'g' },
  { name: 'Tea Powder', unit: 'g' },
  { name: 'Pingani Cups - White', unit: 'pieces' },
  { name: 'Sand Wich Box - Triyangle', unit: 'pieces' },
  { name: 'Sand Wich Box - Square', unit: 'pieces' },
  { name: 'French Fries Parcel Boxes', unit: 'pieces' },
  { name: 'Wooden Spoons', unit: 'pieces' },
  { name: 'Wooden Forks', unit: 'pieces' },
  { name: 'Coffee Stirrer', unit: 'pieces' },
  { name: 'Ro 16 - Bowl', unit: 'pieces' },
  { name: 'Sip Glass - 300 Ml', unit: 'pieces' },
  { name: 'Boat Tray - Small', unit: 'pieces' },
  { name: 'Boat Tray - Big', unit: 'pieces' },
  { name: 'Tape - 2 Inch', unit: 'pieces' },
  { name: 'Tissues', unit: 'pieces' },
  { name: 'Carry Bags- Small Size - 9x11', unit: 'g' },
  { name: 'Carry Bags- Big Size -11x14', unit: 'g' },
  { name: 'Water Bottles', unit: 'pieces' },
  { name: 'Tea Cups', unit: 'pieces' },
  { name: 'Juice Glass Plastic', unit: 'pieces' },
  { name: 'Juice Glass Plastic With Blacklid', unit: 'pieces' },
  { name: 'Gaju Glass 6 Pc Set', unit: 'pieces' },
  { name: 'Tea Pouches -250ml', unit: 'pieces' },
  { name: 'Tea Pouches - 500 Ml', unit: 'pieces' },
  { name: 'Straws', unit: 'pieces' },
  { name: 'Milk', unit: 'ml' },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** Free-typed SOP ingredient names → TVANAMM item. Unknown names are skipped. */
const SOP_NAME_TO_ITEM: Record<string, string> = Object.fromEntries(
  (
    [
      [['tea powder', 'tea poedr'], 'Tea Powder'],
      [['elachi powder', 'pinch of elachi powder'], 'Elachi Powder'],
      [['kadak chai masala', 'kadak masala'], 'Kadak Masala'],
      [['coffee powder'], 'Coffee Powder'],
      [['sonti powder'], 'Sonti Powder'],
      [['badam powder'], 'Badam Powder'],
      [['bellam powder'], 'Bellam Powder'],
      [['rose powder'], 'Rose Powder'],
      [['pepper mint', 'pepper mint tea'], 'Pepper Mint Tea'],
      [['hibiscus flowder', 'hibiscus'], 'Hibiscus'],
      [['blue pea'], 'Blue Pea'],
      [['jasmine'], 'Jasmine'],
      [['lemon grass'], 'Lemon Grass'],
      [['chamomile tea', 'chamomile'], 'Chamomile'],
      [['lavender', 'lavendor'], 'Lavendor'],
      [['oolong'], 'Oolong'],
      [['rose tea', 'rose tea petals'], 'Rose Tea Petals'],
      [['grean tea leaf', 'green tea'], 'Green Tea'],
      [['chocolate syrp', 'chocolate syrep', 'chocolate syrup', 'chocolate'], 'Chocolate Syrup'],
      [['pine apple crush'], 'Pine Apple Crush'],
      [['kiwi crush'], 'Kiwi Crush'],
      [['rose syrep', 'rose syrup'], 'Rose Red Syrup'],
      [['lime & ginger'], 'Lime &Ginger Syrup'],
      [['lime & mint'], 'Lime & Mint Syrup'],
      [['blue berrry syrp', 'blue berry syrup'], 'Blue Berry Syrup'],
      [['blue buracao', 'blue curacao'], 'Blue Curraco Syrup'],
      [['strawberry cresh', 'strawberry crush'], 'Strawberry Crush'],
      [['ras berry', 'rasberry'], 'Rasberry Syrup'],
      [
        [
          'vanilla',
          'ice crame vanilla',
          'vanila ice cram',
          'vanilla ice ceam',
          'vanilla ice cream',
        ],
        'Vanilla Ice Cream',
      ],
      [['adf'], 'A.D.F Ice Cream'],
      [['butter scotch'], 'Butter Scotch Ice Cream'],
      [['caramel nuts'], 'Caramel Nuts Ice Cream'],
      [['black current'], 'Black Current Ice Cream'],
      [['milk'], 'Milk'],
    ] as const
  ).flatMap(([names, item]) => names.map((n) => [n, item] as const)),
);

/** Pre-fill the stock check from the chef's own ingredient list, per ONE serving
 *  (batch amounts divided by servings per batch). Nothing is confirmed yet. */
export function suggestChefStockCheck(draft: ChefDraft): ChefStockCheck {
  const perBatch = draft.basis === 'batch' ? Number(draft.servingsPerBatch) || 1 : 1;
  const lines: ChefStockLine[] = [];
  for (const ing of draft.ingredients) {
    const item = SOP_NAME_TO_ITEM[norm(ing.name)];
    const known = TVANAMM_STOCK_ITEMS.find((i) => i.name === item);
    if (!item || !known || lines.some((l) => l.item === item)) continue;
    const q = Number(ing.quantity);
    const per = q > 0 ? Number((q / perBatch).toFixed(2)) : 0;
    lines.push({ item, quantity: per > 0 ? String(per) : '', unit: known.unit, confirmed: false });
  }
  return { lines, container: '', confirmed: false };
}
