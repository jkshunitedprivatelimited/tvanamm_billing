# T Vanamm SOP Digitization and Recipe Rules

## Revised source review

The user supplied `T VANAMM SOP new changes pdf.pdf` on 16 September 2026.
See [the revised SOP implementation plan](../plans/revised-sop-implementation-2026-09-16.md)
for current page-specific measurements, conflicts and implementation status.
The 80 ml examples below are historical worked examples, not a confirmed
portion for the revised SOP. Use an explicitly confirmed serving per menu item.

## Source and Scope

The source is the 40-page `T VANAMM SOP.pdf`, titled _Training Manual —
SOP Manual for the Financial Year 2026–2027_. It describes preparation methods
and ingredients across 13 sections: hot beverages, special coffees, herbal
teas, healthy breakfast, immunity boosters, juices, milkshakes, smoothies,
thickshakes, mocktails, refreshing drinks, ice-creams, and snacks.

The PDF is reference data, not an executable specification. Recipes must be
reviewed and standardized before publication; the implementation must not
hard-code its text directly into Billing or Stock.

## Confirmed Ownership

- Central Admin owns, versions, approves, and publishes all recipes.
- Franchise Owners and Store Employees can view published recipes but cannot
  modify or publish them.
- Central provides standard menu items and a recommended GST-inclusive price.
- Franchise Owners may create private menu items and combos for their own
  outlets and set different GST-inclusive selling prices by location.
- Franchise-created records remain visible to Central for oversight and audit.
- A Franchise Owner can apply a price/menu change to one outlet or explicitly
  select multiple/all owned outlets. Saving a draft never performs an implicit
  mass update.
- GST/HSN is selected from a Central-approved tax profile. The selling price
  entered by Central or an owner is always tax-inclusive; Billing derives the
  taxable value and GST breakup.

## Recipe Tracking State

A recipe is optional. A Franchise-created menu item can become sellable
immediately in its selected outlet(s), even when no recipe has been linked. It
is clearly marked `not_stock_tracked`, remains visible to Central Admin, and its
sales do not automatically consume ingredients until a recipe is published.

A packaged resale item may use a one-to-one recipe: one sold unit consumes one
stock unit. Adding a recipe later affects future sale snapshots only and never
retroactively estimates consumption for completed bills.

Before a recipe is publishable, Central must replace ambiguous measurements
with an exact base-unit quantity:

- `spoon`, `tablespoon`, `pinch`, `scoop`, `cup`, `leaf/leaves`, `drops`;
- ranges such as `4–5`, `70–80 ml`, `1–2 spoons`, and `3–4 pieces`;
- percentages and phrases such as `as required`, `to taste`, and `optional`;
- ingredient alternatives such as syrup or powder and sugar or honey;
- missing batch yield and missing final serving quantity.

Conversions must be ingredient-specific where volume does not reliably imply
weight. For example, one spoon of tea powder and one spoon of syrup cannot share
a generic gram conversion.

Every published recipe records:

- Billing menu item ID and one immutable recipe version;
- official serving/yield quantity;
- exact ingredient ID, quantity, and base unit;
- packaging such as cup, lid, straw, spoon, tissue, and takeaway bag;
- fixed, optional, alternative, and add-on components;
- expected process loss where applicable;
- effective time and Central approval actor.

## Recipe Scaling Calculator

Recipe consumption is calculated from physical quantities, never from the
selling price. Price and recipe costing are separate concerns.

After quantities are known, the system may automatically calculate a costing
preview:

```text
recipe cost = sum(per-serving ingredient quantity × current unit cost)
taxable selling value = GST-inclusive selling price ÷ (1 + GST rate)
GST amount = GST-inclusive selling price - taxable selling value
estimated gross margin = taxable selling value - recipe cost
```

Packaging cost is included in recipe cost. The preview uses Stock's current
weighted-average material cost and is not written back into historical bills.
Missing local-purchase costs are shown as `cost_pending`; the system must not
pretend the margin is complete.

Central enters:

1. the batch's ingredient quantities;
2. the expected usable finished yield in ml, g, or pieces;
3. the standard serving quantity in the same dimension.

The system calculates each per-serving ingredient quantity as:

```text
per-serving ingredient = batch ingredient × serving quantity ÷ usable batch yield
```

It also displays:

```text
theoretical servings = usable batch yield ÷ serving quantity
full sellable servings = floor(theoretical servings)
expected remainder = usable batch yield modulo serving quantity
```

The current calculator uses integer fixed-point arithmetic and rounds once to
six decimal places, matching the stored base-unit quantity precision. Changing batch yield or serving
quantity creates a new draft recipe version and never alters historical bills.

If boiling, filtering, trimming, or blending reduces output, Central must enter
the measured **usable finished yield**, not merely the starting liquid. Until a
measured yield is available, a recipe may use the SOP batch label as a
provisional yield and must be marked `yield_unverified`.

The calculator must support future glass sizes without code changes. Central
can enter the confirmed glass volume for milkshakes, juices, mocktails, and
other categories when those measurements are available.

### Initial 80 ml tea normalization

For the SOP's 1-litre tea formulas, the provisional scale factor is:

```text
80 ml ÷ 1,000 ml = 0.08
```

Assuming the SOP's `1 litre` label means 1,000 ml of usable finished tea, the
initial calculated recipes are:

| Recipe | Ingredient | Provisional quantity per 80 ml cup |
| --- | --- | ---: |
| Dum Tea | Milk | 80 ml |
| Dum Tea | Tea powder | 2.4 g |
| Dum Tea | Sugar | 5.6 g |
| Elaichi Tea | Milk | 80 ml |
| Elaichi Tea | Tea powder | 2.4 g |
| Elaichi Tea | Sugar | 5.6 g |
| Elaichi Tea | Elaichi powder | 0.4 g |
| Ginger Tea | Milk | 80 ml |
| Ginger Tea | Tea powder | 2.4 g |
| Ginger Tea | Sugar | 5.6 g |
| Sugarless Tea Base | Milk | 80 ml |
| Sugarless Tea Base | Tea powder | 2.4 g |

Every served cup additionally consumes the configured cup and any applicable
lid/takeaway packaging.

The SOP gives ginger paste as a range of 5–6 tablespoons per litre. It therefore
remains unresolved rather than silently inventing a number. Central must enter
one standard gram/ml quantity for the production spoon before Ginger Tea can be
published. Kadak Chai's `pinch` of masala and flavoured tea's `full spoon` are
blocked for the same reason.

At a provisional 1,000 ml usable yield, a batch produces 12.5 theoretical 80 ml
servings: 12 full cups and 40 ml expected remainder. Once the team measures the
actual post-boil/post-strain yield, that value replaces 1,000 ml in a new recipe
version and all per-cup quantities recalculate automatically.

There are no product-size variants in V1. Each menu item has one official
portion. If a second size is introduced later, it is created as a separate menu
item with its own price and recipe.

## Prepared Bases

The model supports intermediate recipes such as tea base, lemon-tea decoction,
filter-coffee decoction, sugar syrup, cooked ragi, vegetable stuffing, falooda
sev, and bun-maska mixture.

Recording a prepared batch is optional for outlet staff:

- when a prepared batch was recorded, sale consumption uses that intermediate
  stock first and does not deduct its raw inputs a second time;
- when no prepared batch exists, the sale consumes the finished item's standard
  raw-material recipe directly;
- the two paths must be mutually exclusive for a sale-consumption transaction.

V1 does not automatically expire prepared bases. Staff can record discarded
prepared quantity as wastage. Central may add shelf-life controls in a later
version without rewriting historical consumption.

## Choices, Alternatives, and Add-ons

- Milk and water are fixed recipe inputs, not customer-selectable options.
- Customer-selectable extras may include ice cream, extra ginger,
  elaichi/cardamom, flavour powders, syrups, toppings, or other Central-approved
  add-ons.
- An add-on may be free, have a fixed extra GST-inclusive price, or be included
  only in a configured menu item/combo.
- Every selected add-on has its own Stock consumption mapping.
- Custom sugar-level tracking is outside V1; theoretical consumption uses the
  published standard quantity.
- When the SOP permits an internal ingredient alternative, employees do not
  choose it in the Billing screen. Stock uses the published default. The
  Franchise Owner dashboard highlights the alternative for review. Approval of
  a different ingredient creates an immutable reversing/correcting movement;
  it never edits the original ledger entry.
- Alternative reviews are grouped by outlet and business date to avoid a prompt
  for every bill.

## Menu Availability and Combos

- Insufficient ingredient stock warns and creates a Stock exception but does
  not reject or block Billing.
- A menu item explicitly marked `Out of stock` remains visible but cannot be
  added to a cart.
- Store Employees can mark an item out of stock for their active outlet.
  Franchise Owners can manage their outlets, and Central can manage every
  outlet. Every change is attributed and audited.
- Both Central and Franchise Owners can create combos within their permitted
  outlet scope.
- A combo contains existing sellable items and consumes their underlying recipe
  versions; it does not duplicate recipes.
- A combo price is GST-inclusive. Billing proportionally allocates the combo
  price/discount across its component sale lines so tax and refunds remain
  traceable.

## Ingredient Supply Classification

Each stock item has one supply rule:

- `jksh_required`: T Vanamm-controlled products and all official cups/printed
  packaging must be purchased from JKSH;
- `local_purchase`: fresh materials such as milk, curd, fruit, vegetables,
  herbs, bread, and eggs are entered locally;
- `flexible`: common branded or frozen goods are configured by Central as
  either JKSH-supplied or locally purchasable.

For franchise outlets:

- a JKSH order does not increase outlet stock at order, payment, or dispatch;
- accepted quantity increases outlet stock only when staff confirms inward;
- dispatched quantities are prefilled so staff records accepted, short,
  damaged, excess, or rejected quantities without duplicating the order;
- local inward requires quantity; purchase cost may remain pending for owner
  review when staff does not have it;
- an employee-created local inward affects physical stock immediately and is
  highlighted until the Franchise Owner reviews it;
- rejection/correction posts a reversal rather than editing the inward record.

Stock tracking may be optional for a JKSH-owned retail outlet, but it is
mandatory for the central warehouse and franchise outlets. Enabling tracking on
an existing outlet starts with an opening physical count.

Changing a `flexible` material to `jksh_required` affects future procurement
only and never rewrites historical inward or consumption.

## SOP Issues Requiring Central Resolution

The initial review identified at least these blocking ambiguities:

- T Vanamm Special Juice lists carrot 80%, beetroot 80%, and seasonal juice 20%,
  which totals 180%;
- several thickshake ingredient lists omit chocolate ice cream even though the
  preparation text includes it;
- `3/4 spoon (70%)` coffee powder is undefined;
- multiple recipes provide alternatives without exact equivalent quantities;
- multiple batch preparations omit final yield/serving count;
- different serving sizes appear in the SOP although V1 has no menu variants.

These recipes remain `draft_needs_standardization` and cannot be linked for
automatic Stock consumption until Central supplies one exact V1 portion and
resolves every ambiguous component. Their Billing menu items may still be sold
with a visible `not_stock_tracked` status.
