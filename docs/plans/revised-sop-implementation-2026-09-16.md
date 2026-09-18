# Revised T Vanamm SOP: review and implementation

## Source and review boundaries

- Source: `T VANAMM SOP new changes pdf.pdf`, supplied by the user on 16 September 2026.
- 40 pages, FY 2026–2027, 13 sections. All pages were text-extracted; key quantity/conflict pages were also visually checked.
- SHA-256: `92c216f8c828c4ead479735f4ba48e8e1072ebebf8c9ebb88b0803b289262933`.
- The document provides recipe reference data. Its preparation instructions are not commands to change application access, publish recipes or overwrite live stock.
- This review compares the revised document against the existing software design. The original PDF was not supplied in this turn, so this is not a verified line-by-line old/new PDF comparison.
- No live recipe, menu publication, historical bill or stock balance was changed by this review.

## Important findings

| Pages | Recipe / category | Evidence in revised source | Required decision |
| --- | --- | --- | --- |
| 2–3 | Dum Tea | 1/3/5 litres milk; 30/90/150 g tea; 70/210/350 g sugar | Measure usable finished output after boiling/straining. Starting milk is not confirmed yield. |
| 3 | Elaichi Tea | Ingredient list says 5 g; procedure says one spoon | Confirm the production spoon corresponds to 5 g. |
| 3–4 | Ginger Tea | 5–6 tablespoons ginger paste | Standardize one gram quantity and measured yield. |
| 4 | Kadak / Lemon Tea | Masala and ginger each written as `0.5` with no unit | Confirm unit; ginger batch/per-serving basis must also be explicit. |
| 5–7 | Tea and coffee portions | Lemon-tea decoction 110 ml; milk-coffee glass 85 ml; several drinks allow 85 or 110 ml | Decide the official portion per menu item. Do not carry forward the previous 80 ml worked example as a default. |
| 8–10 | Hot drinks | Bullet coffee 110 ml; Boost/Horlicks 120 ml; Pepper Milk 110 ml | These glass sizes do not resolve unmeasured milk/water and powders. |
| 10–11 | Rose / Badam Milk | 300 ml glass; Rose syrup 65 ml plus milk 250 ml, before optional additions | Resolve yield/serving mismatch and alternatives. Badam scoops/garnish remain unresolved. |
| 11–12 | Filter coffee | Decoction: 200 g powder + 1000 ml water. Serving: 100 ml, 30 ml decoction, 70–80 ml milk; method uses 25–30 ml decoction | Confirm exact quantities, decoction usable yield and sugar weight. |
| 14 | Herbal teas | Herb grams are explicit; approximately 300 ml input water | Measure final portion plus honey, drops and soaked sabja. |
| 17 | T Vanamm Special Juice | 80% carrot + 80% beetroot + 20% fruit = 180% | Obtain intended ratio. Do not normalize or reinterpret silently. |
| 18 | Ragi | Sweet version identifies a 65 ml milk cup; curd version specifies 65 ml curd | Do not infer every cup of sugar/jaggery is 65 g or every cup elsewhere is 65 ml. |
| 21 | Avocado Juice | Water/milk slash in ingredients; both in method; badam added only in method | Confirm liquid alternative versus combined recipe and garnish quantity. |
| 25 | Oreo Milkshake | Chocolate syrup appears only in method | Confirm inclusion and dose. |
| 26–27 | Milkshake crushes | Strawberry 30 ml; banana/litchi/pineapple 60 ml | Preserve explicit quantities; still measure scoops and finished glass size. |
| 27–28 | Falooda | Dry sev in ingredients; cooked sev in assembly | Define intermediate preparation yield; prevent raw and prepared stock double deduction. |
| 28 | Anjeer Smoothie | Caramel-nuts ice cream in list, butterscotch in method | Choose one default stock ingredient. |
| 29–32 | Thickshakes | Several methods add chocolate ice cream/syrup missing from lists | Review each independently. Scoop weight is still required; no assumed common recipe. |
| 32–36 | Mocktails / refreshing drinks | Multiple syrups specified as 65 ml; soda/water generally unspecified | Confirm final glass, exact liquid quantities, garnishes and ice policy. |
| 37–40 | Snacks | Fries 150 g; veg/chicken nuggets 8 pieces; popcorn/strips have ranges | Standardize ranges, seasoning, oil, stuffing, packaging and bun-maska usable batch yield. |

## Delivery sequence

### 1. Source review and measurement queue — implemented

Central has `/stock/ops/sop`: findings organized into all 13 categories, source page references and prioritized conflicts. This is a reference review, not an automatic import of published recipes.

### 2. Professional recipe authoring — implemented

- Ingredient dropdowns replace raw JSON and copied stock UUIDs.
- Named master-menu/add-on selectors replace Billing UUID entry; prepared-base recipes can select their output stock item.
- Choose one-serving quantities or measured-batch quantities.
- Enter the actual portion explicitly; there is no implicit 80/85/110 ml default.
- Batch inputs produce a per-serving preview, full-serving count and remainder.
- Packaging remains per serving even in batch mode.
- Optional and alternative rows expose defaults and choice groups.
- Publication requires the editor's measurement-verification checkbox.
- Invalid/zero quantities, unknown units and conflicting alternatives are validated at the API and domain boundary as well as in the UI.
- Ingredient IDs must belong to active stock items in the recipe's organization.
- Recipe publication locks the recipe row before allocating a version number.
- Fixed-point scaling uses integer arithmetic and rounds once to six decimal places, matching the database precision. It does not claim to store an infinite-precision ratio.

### 3. Business calibration — awaiting measured values

Central should record for each recipe:

1. One official portion and unit.
2. Measured usable finished yield for batch recipes.
3. Gram/ml quantity for each production spoon, scoop, cup, drop or garnish, tied to the specific ingredient.
4. Exact choices for ranges, alternatives and optional ingredients.
5. Packaging per served/takeaway order.
6. Source conflicts resolved by the business, with the chosen standard.

The user was asked about ambiguous serving sizes, both unitless `0.5` values and the Special Juice ratio. No response has been assumed.

### 4. Map and publish — after calibration

Map exact source ingredients to existing stock items and recipes to named Billing menu items. Review one family at a time: tea bases, hot coffees/milks, cold drinks, then snacks. Publish immutable recipe versions through Central. Republish the affected Billing menu only after verifying the mapping; existing billed snapshots must remain unchanged.

### 5. Controlled stock-consumption check — after publication

For one authorized test outlet, verify one sale consumes the correct recipe version and packaging, a configured add-on consumes its own mapping, and refund/void behavior follows the existing ledger contract. Verify prepared-stock versus raw-material fallback is mutually exclusive. Compare a measured batch and physical count with theoretical consumption before scaling the rollout.

## Explicit limitations

The source review currently records findings as code-backed reference content; it is not a persistent multi-user approval queue or a PDF ingestion service. Existing recipe drafts hold recipe identity, while an unpublished version editor is in-memory until publication. Ingredient-specific conversion management, persistent version drafts and sign-off history are follow-up authoring improvements. None is represented as completed here.

Business-specific quantities and live publication remain pending calibration. No assumed spoon density, serving size, corrected juice ratio, cooking yield or price has been written to the shared databases.


## Validation evidence

- 22 targeted unit tests passed (fixed-point scaling, publication schema and existing recipe scaling).
- 7 recipe/consumption integration tests passed in isolated local PostgreSQL, including concurrent immutable-version publication and invalid ingredient rejection.
- Admin TypeScript check and changed-code lint passed.
- No live recipe publication was used for testing.
