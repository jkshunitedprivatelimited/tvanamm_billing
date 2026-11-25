# Missing items review — 10 October 2026

Read-only comparison completed at 16:52 IST against the locally configured shared
Billing and Stock databases. Their association with deployed application projects
has not been independently established. No catalog, availability setting, SOP,
recipe, stock balance or published menu was changed.

## Findings

- All 128 active master catalog items are in the central SOP workbook.
- The workbook excludes 43 active outlet-created records: 35 from Bengaluru,
  7 from Araku and 1 named Package in Test2. These records need explicit SOP
  coverage review. They are not automatically 43 distinct new recipes.
- Six outlet records have an exact normalized name match to a master item, but all
  six have different category labels. For example, Chocolate and Vanilla are
  outlet milkshakes while the same master names are ice creams. Name matching
  alone must not choose their recipe.
- Sweet Lassi appears twice in Bengaluru, in Lassi and Other categories. Keep both
  records intact while the business determines whether these are distinct items.
- The six active Billing-enabled outlets checked each have a current menu
  snapshot containing all eligible active catalog IDs for that outlet/brand.
  This check covers database snapshots, not an actual terminal's downloaded menu
  or its category/search filters.
- Current availability settings mark five Bengaluru records unavailable. Their
  saved published snapshot also has five unavailable labels, but the lists differ.
  Verify the deployed POS behavior and downloaded version before diagnosing an
  on-device display issue; do not republish or enable items without reviewing why.
- Only three active Stock material records exist: Milk, Sugar and Tea powder.
  The 55 ready SOPs contain 91 normalized ingredient labels; 88 labels have no
  exact normalized match to those Stock names. Some are spelling variants,
  alternatives or prepared intermediates, so 88 is a mapping-review count, not a
  confirmed count of new materials to create.
- No active add-on records were found in active add-on groups in this organization.
  If the business expects sellable extras, obtain their names and approved quantities.

The SOP link stores a master-menu snapshot at creation. It does not automatically
include outlet-created catalog items or newly added master items. All current
master items happen to be covered in this snapshot.

## Outlet records outside the central workbook

### Tvanamm_Bangalore — 35 records

| Item                      | Category          | Same-name master category to review |
| ------------------------- | ----------------- | ----------------------------------- |
| Apple                     | Milk Shakes       | No exact name match                 |
| Avacado                   | Milk Shakes       | No exact name match                 |
| Black Tea                 | Tea               | Hot Beverages                       |
| Bread Butter Toast        | Healthy Breakfast | No exact name match                 |
| Bread Omlette             | Healthy Breakfast | No exact name match                 |
| Bun Maska                 | Snacks            | No exact name match                 |
| Bun Maska with Badam Milk | Snacks            | No exact name match                 |
| Butter Sweet Corn         | Snacks            | No exact name match                 |
| Cheese Maggi              | Snacks            | No exact name match                 |
| Cheese Nachos             | Snacks            | No exact name match                 |
| Chikoo                    | Milk Shakes       | No exact name match                 |
| Chocolate                 | Milk Shakes       | Ice Creams                          |
| Dragon Fruit              | Milk Shakes       | No exact name match                 |
| Filter Coffee             | Coffee            | Hot Beverages                       |
| Hot Badam Milk            | Milk              | No exact name match                 |
| Italian Veg Salad         | Healthy Breakfast | No exact name match                 |
| Lemon Juice               | Healthy Juices    | No exact name match                 |
| Mango                     | Ice Creams        | No exact name match                 |
| Mango (Seasonal)          | Milk Shakes       | Healthy Juices                      |
| Masala Sweet Corn         | Snacks            | No exact name match                 |
| Mini Veg Pizza            | Snacks            | No exact name match                 |
| Muskmelon Milkshake       | Milk Shakes       | No exact name match                 |
| Nachos                    | Snacks            | No exact name match                 |
| Paneer Pizza              | Snacks            | No exact name match                 |
| Panner Cheese Bun         | Snacks            | No exact name match                 |
| Papaya                    | Milk Shakes       | Healthy Juices                      |
| Peanut Butter Toast       | Healthy Breakfast | No exact name match                 |
| Snacks Parcel             | Parcel            | No exact name match                 |
| Sweet Lassi               | Lassi             | No exact name match                 |
| Sweet Lassi               | Other             | No exact name match                 |
| Tea Parcel                | Parcel            | No exact name match                 |
| Vanilla                   | Milk Shakes       | Ice Creams                          |
| Veg Corn Pizza            | Snacks            | No exact name match                 |
| Water 500 ml              | Water             | No exact name match                 |
| Water Bottle 1 Ltr        | Water             | No exact name match                 |

### Tvanamm_Araku — 7 records

| Item                 | Category          | Same-name master category to review |
| -------------------- | ----------------- | ----------------------------------- |
| Boiled Egg (2pieces) | Snacks            | No exact name match                 |
| Chicken Crisper      | Snacks            | No exact name match                 |
| CHICKEN NUGGETS      | Snacks            | No exact name match                 |
| Chicken Popcorn      | Snacks            | No exact name match                 |
| Egg Maggie           | Snacks            | No exact name match                 |
| Water Bottle(1000ml) | Refreshing Drinks | No exact name match                 |
| Water Bottle(500ml)  | Refreshing Drinks | No exact name match                 |

### Test2 — 1 records

| Item    | Category | Same-name master category to review |
| ------- | -------- | ----------------------------------- |
| Package | Other    | No exact name match                 |

## Items marked unavailable

Current catalog and outlet override settings:

- Tvanamm_Bangalore: **Badam Milk** (master item).
- Tvanamm_Bangalore: **Cheese Balls** (master item).
- Tvanamm_Bangalore: **Cheese Maggi** (outlet item).
- Tvanamm_Bangalore: **Lassi** (master item).
- Tvanamm_Bangalore: **Sweet Lassi** (outlet item).

Unavailable labels saved in the current published menu snapshot:

- Tvanamm_Bangalore: Lassi.
- Tvanamm_Bangalore: Cheese Maggi.
- Tvanamm_Bangalore: Garlic Cheese Toast.
- Tvanamm_Bangalore: Badam Milk Hot.
- Tvanamm_Bangalore: Sweet Lassi.

These labels can differ due to subsequent authoring, outlet naming overrides and
availability changes. The review preserves those differences as evidence rather
than treating them as a request to overwrite a published menu.

## Ingredient labels requiring Stock mapping review

Existing active Stock items are Milk (ml), Sugar (g) and Tea powder (g).
Keep spelling, preparation state, unit and alternative-choice review explicit.
For example, SUAGR and TEA POEDR may refer to existing materials; HONEY & SUGAR,
SUGAR ARE HONEY and prepared decoctions require a business decision before mapping.
Packaging must also be extracted from the SOP packaging instructions separately.

| Saved ingredient label | Saved unit(s) | Ready SOPs using it                                                                                                                                                                                                                                   |
| ---------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SONTI POWDER           | g             | Sonti Tea; Sonti Milk                                                                                                                                                                                                                                 |
| ELACHI POWDER          | g             | Elachi Tea                                                                                                                                                                                                                                            |
| GINGER                 | g, ml         | Ginger Tea; Kadak Chai                                                                                                                                                                                                                                |
| ELACHI TEA             | ml            | Kadak Chai                                                                                                                                                                                                                                            |
| KADAK CHAI MASALA      | g             | Kadak Chai                                                                                                                                                                                                                                            |
| WATER                  | ml, g         | Black Tea; Avacado Juice; Grapes; Black Coffee; Mango (Seasonal); Papaya; Oat Meal; Dragon; Orange; Pine Apple; Bullet Coffee; Hibiscus Tea; Blue Pea Tea; Jasmine Tea; Lemon Grass Tea; Chamomile Tea; Lavender Tea; Oolong Tea; Rose Tea; Green Tea |
| SUGAR ARE HONEY        | g             | Black Tea                                                                                                                                                                                                                                             |
| ICE CRAME VANILLA      | ml            | Badam Milk                                                                                                                                                                                                                                            |
| BADAM POWDER           | g             | Badam Milk; Badam Tea                                                                                                                                                                                                                                 |
| TEA POEDR              | g             | Badam Tea                                                                                                                                                                                                                                             |
| COFFEE POWDER          | g             | Coffee; Bellam Coffee; Cold Coffee; Black Coffee; Bullet Coffee                                                                                                                                                                                       |
| BELLAM POWDER          | g             | Bellam Tea                                                                                                                                                                                                                                            |
| APPLE                  | pieces, g     | Apple Juice; Corn Flakes; Fruit Bowl; Fruit Salad                                                                                                                                                                                                     |
| CORN FLACKS            | g             | Corn Flakes                                                                                                                                                                                                                                           |
| CHOPPED BADAM          | pieces        | Corn Flakes; Oat Meal                                                                                                                                                                                                                                 |
| KISS MISS              | pieces        | Corn Flakes; Fruit Salad; Oat Meal                                                                                                                                                                                                                    |
| DATE                   | pieces        | Corn Flakes                                                                                                                                                                                                                                           |
| POMAGANETE             | g             | Corn Flakes                                                                                                                                                                                                                                           |
| CARROT                 | g, pieces     | Carrot; Veg Salad                                                                                                                                                                                                                                     |
| HONEY                  | g             | Carrot; Beetroot; Avacado Juice; Pepper Mint Tea; Hibiscus Tea; Blue Pea Tea; Jasmine Tea; Lemon Grass Tea; Chamomile Tea; Lavender Tea; Oolong Tea; Rose Tea; Green Tea; Lemon Tea                                                                   |
| BEETROOT               | g             | Beetroot                                                                                                                                                                                                                                              |
| CHOCOLATE              | ml            | Cold Coffee                                                                                                                                                                                                                                           |
| VANILA ICE CRAM        | g             | Cold Coffee                                                                                                                                                                                                                                           |
| AVACADO                | pieces        | Avacado Juice                                                                                                                                                                                                                                         |
| BANANA                 | pieces        | Banana; Fruit Bowl                                                                                                                                                                                                                                    |
| GRAPES                 | g             | Grapes                                                                                                                                                                                                                                                |
| KIWI                   | g             | Kiwi                                                                                                                                                                                                                                                  |
| kiwi crush             | ml            | Kiwi                                                                                                                                                                                                                                                  |
| ROSE SYREP             | ml            | Rose Milk                                                                                                                                                                                                                                             |
| ICE CREAM              | g             | Rose Milk                                                                                                                                                                                                                                             |
| SABAJA SEEDS           | g             | Rose Milk; Pepper Mint Tea                                                                                                                                                                                                                            |
| PEPPER POWDER          | g             | Pepper Milk; Veg Salad                                                                                                                                                                                                                                |
| MUSK MELON             | pieces, g     | Fruit Bowl; Musk Melon                                                                                                                                                                                                                                |
| WATER MELON            | pieces, g     | Fruit Bowl; Water Melon                                                                                                                                                                                                                               |
| PINE APPLE             | pieces, g     | Fruit Bowl; Veg Salad; Pine Apple                                                                                                                                                                                                                     |
| SUAGR                  | g             | Chocolate Milk; Filter Coffee                                                                                                                                                                                                                         |
| CHOCOLATE SYREP        | g             | Chocolate Milk                                                                                                                                                                                                                                        |
| MANGO                  | g             | Mango (Seasonal)                                                                                                                                                                                                                                      |
| PAPAYA                 | g             | Papaya                                                                                                                                                                                                                                                |
| FULL BANANA            | pieces        | Fruit Salad                                                                                                                                                                                                                                           |
| POMEGRANATE            | g             | Fruit Salad; Oat Meal                                                                                                                                                                                                                                 |
| FRESH CREAM            | ml            | Fruit Salad                                                                                                                                                                                                                                           |
| MILK MADE              | g             | Fruit Salad                                                                                                                                                                                                                                           |
| BADAM CHOPPER          | g             | Fruit Salad                                                                                                                                                                                                                                           |
| CHOPPED DATES          | pieces        | Fruit Salad                                                                                                                                                                                                                                           |
| OATS                   | g             | Oat Meal                                                                                                                                                                                                                                              |
| DATES                  | pieces        | Oat Meal                                                                                                                                                                                                                                              |
| CHOPPED APPLE          | pieces        | Oat Meal                                                                                                                                                                                                                                              |
| CHOPPED BANANA         | pieces        | Oat Meal                                                                                                                                                                                                                                              |
| HONE & SUGAR           | g             | Oat Meal                                                                                                                                                                                                                                              |
| KIRA                   | pieces        | Veg Salad                                                                                                                                                                                                                                             |
| CABAZI                 | pieces        | Veg Salad                                                                                                                                                                                                                                             |
| BELL PEPPER            | pieces        | Veg Salad                                                                                                                                                                                                                                             |
| MAYO                   | g             | Veg Salad                                                                                                                                                                                                                                             |
| Salt                   | g             | Veg Salad                                                                                                                                                                                                                                             |
| TOMATO                 | pieces        | Veg Salad                                                                                                                                                                                                                                             |
| DRAGON                 | g             | Dragon                                                                                                                                                                                                                                                |
| POMEGRANTE             | g             | Pomegranate                                                                                                                                                                                                                                           |
| SAPAOTA                | pieces        | Sapota                                                                                                                                                                                                                                                |
| HORLICKS               | g             | Sapota; Horlicks                                                                                                                                                                                                                                      |
| Fresh strawberries     | pieces        | Strawberry (Seasonal)                                                                                                                                                                                                                                 |
| ORANGE                 | pieces        | Orange                                                                                                                                                                                                                                                |
| PINE APPLE CRUSH       | ml            | Pine Apple                                                                                                                                                                                                                                            |
| BUTTER                 | g             | Bullet Coffee                                                                                                                                                                                                                                         |
| GHEE                   | g             | Bullet Coffee                                                                                                                                                                                                                                         |
| HONEY & SUGAR          | g             | Bullet Coffee                                                                                                                                                                                                                                         |
| WATEER                 | ml            | Pepper Mint Tea                                                                                                                                                                                                                                       |
| PEPPER MINT            | g             | Pepper Mint Tea                                                                                                                                                                                                                                       |
| HIBISCUS FLOWDER       | g             | Hibiscus Tea                                                                                                                                                                                                                                          |
| SABAJA SEEDS 1/2 SPOON | g             | Hibiscus Tea; Rose Tea; Green Tea; Lemon Tea                                                                                                                                                                                                          |
| BLUE PEA               | g             | Blue Pea Tea                                                                                                                                                                                                                                          |
| SABAJA SEEDS 1/5 SPOON | g             | Blue Pea Tea; Jasmine Tea; Chamomile Tea; Oolong Tea                                                                                                                                                                                                  |
| JASMINE                | g             | Jasmine Tea                                                                                                                                                                                                                                           |
| LEMON GRASS            | g             | Lemon Grass Tea                                                                                                                                                                                                                                       |
| SABAJA SEEDA 1/5 SPOON | g             | Lemon Grass Tea                                                                                                                                                                                                                                       |
| CHAMOMILE TEA          | g             | Chamomile Tea                                                                                                                                                                                                                                         |
| LAVENDER               | g             | Lavender Tea                                                                                                                                                                                                                                          |
| SABAJA SEEDS 1/5       | g             | Lavender Tea                                                                                                                                                                                                                                          |
| OOLONG                 | g             | Oolong Tea                                                                                                                                                                                                                                            |
| BOOST                  | g             | Boost                                                                                                                                                                                                                                                 |
| ROSE TEA               | g             | Rose Tea                                                                                                                                                                                                                                              |
| GREAN TEA LEAF         | g             | Green Tea                                                                                                                                                                                                                                             |
| LEMON TEA DECOCTION    | ml            | Lemon Tea                                                                                                                                                                                                                                             |
| MINT LEAF              | pieces        | Lemon Tea                                                                                                                                                                                                                                             |
| 1/2 LEMON SLICE        | pieces        | Lemon Tea                                                                                                                                                                                                                                             |
| FILTER COFFEE          | ml            | Filter Coffee                                                                                                                                                                                                                                         |
| CUSTARD POWDER         | g             | Fruit Custard                                                                                                                                                                                                                                         |
| PINCH OF ELACHI POWDER | g             | Fruit Custard                                                                                                                                                                                                                                         |

## Follow-up work

1. Obtain the extra names the user noticed and the place they were missing: SOP
   link, Billing menu or Stock list. This comparison cannot identify an item that
   has never been entered in any available source.
2. Review the outlet records above by outlet, category and actual product. Reuse
   an approved SOP only when ingredient quantities, portion and packaging match.
3. Add reviewed missing items to a persistent SOP coverage workflow, preserving
   existing chef entries and revisions. Decide how snapshot refresh handles new
   master and outlet items without overwriting saved work.
4. Resolve spelling and material identities before creating Stock items; record
   precise units and recipe mapping. Treat packaged water, parcel charges and
   composite items according to their actual stock effect.
5. Reproduce reported Billing omissions using the affected outlet, terminal menu
   version and item availability. Confirm search/category visibility without
   changing live records.

The 24 workbook items without saved SOPs and 49 incomplete drafts are listed in
[Stock completion plan](stock-completion-plan-2026-10-10.md). These are separate
from catalog records absent from the workbook.
