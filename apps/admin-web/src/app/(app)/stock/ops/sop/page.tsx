import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';

const sections = [
  [
    'Hot beverages',
    '2–12',
    'Dum tea ratios are explicit; finished yield is not. Glass sizes now include 85, 100, 110, 120 and 300 ml. Several spoon quantities remain unresolved.',
  ],
  [
    'Special coffees',
    '12–13',
    'Chocolate coffee specifies 100 ml milk and a 110 ml glass. Other powders, syrup spoons and final portions need measurement.',
  ],
  [
    'Herbal teas',
    '13–14',
    'Herb amounts are listed in grams. Water is approximately 300 ml; honey, drops, sabja and final yield still need standards.',
  ],
  [
    'Healthy breakfast',
    '14–17',
    'Vegetable, fruit, dressing and garnish quantities are mostly unspecified. Define edible weights and one bowl portion.',
  ],
  [
    'Immunity boosters',
    '17–19',
    'Special Juice percentages total 180%. Ragi, ginger, herbs and usable yields need clarification.',
  ],
  [
    'Juices',
    '19–25',
    'Separate recipes with milk from those without. Standardize fruit sizes, water ranges, optional sugar, trim loss and final glass volume.',
  ],
  [
    'Milkshakes',
    '25–28',
    'Strawberry crush is 30 ml; banana, litchi and pineapple crush are 60 ml. Scoops, final servings and several ranges remain unresolved.',
  ],
  [
    'Smoothies',
    '28',
    'Resolve honey versus sugar, nut ranges and milk quantity. Anjeer lists caramel-nuts ice cream but the method says butterscotch.',
  ],
  [
    'Thickshakes',
    '29–32',
    'Milk amounts are mostly 65 ml (Belgium Explode: 60 ml). Standardize scoop weights and resolve ingredients added only in the method.',
  ],
  [
    'Mocktails',
    '32–34',
    'Several syrups are 65 ml. Standardize soda, ice, drops, salt, garnish and final glass volume.',
  ],
  [
    'Refreshing drinks',
    '34–36',
    'Some cups are explicitly 65 ml; do not apply that conversion to all cups. Define sugar weight, scoop size and final servings.',
  ],
  [
    'Ice-creams / fruit custard',
    '37',
    'Custard uses 100 ml milk; powder, fruit, sugar and finished serving still need standards.',
  ],
  [
    'Snacks',
    '37–40',
    'Fries: 150 g. Veg and chicken nuggets: 8 pieces. Other portions, stuffing, seasoning, oil use and bun-maska yield need measurement.',
  ],
];
const conflicts = [
  [
    'Special Juice',
    '17',
    'Carrot 80% + beetroot 80% + seasonal fruit 20% totals 180%.',
    'Confirm the intended three-part ratio; do not normalize it automatically.',
  ],
  [
    'Kadak Chai / Lemon Tea',
    '4',
    'Kadak masala and lemon-tea ginger are both written as 0.5 without a unit.',
    'Confirm grams or millilitres and whether the ginger amount applies to the whole decoction batch.',
  ],
  [
    'Filter Coffee',
    '12',
    'Ingredients say 30 ml decoction; method says 25–30 ml. Milk is 70–80 ml for a 100 ml portion.',
    'Choose exact decoction and milk amounts and verify the final serving.',
  ],
  [
    'Tea / coffee glass sizes',
    '6–7',
    'Flavoured tea, Bellam Coffee and Black Coffee allow 85 ml or 110 ml.',
    'Choose one official size per menu item, or create separately named menu items.',
  ],
  [
    'Rose Milk',
    '10–11',
    '65 ml syrup + 250 ml milk already exceeds the stated 300 ml glass; ice cream may also be added.',
    'Measure finished yield and decide the default syrup/powder and optional ice cream/kova.',
  ],
  [
    'Avocado Juice',
    '21',
    'Ingredient line separates water/milk with a slash; method uses both and adds unquantified badam.',
    'Confirm whether both liquids are required and measure garnish.',
  ],
  [
    'Oreo Milkshake',
    '25',
    'The method adds chocolate syrup, but it is missing from the ingredient list.',
    'Confirm inclusion and exact syrup amount.',
  ],
  [
    'Falooda',
    '27–28',
    'Ingredients specify dry sev, while assembly measures cooked sev.',
    'Record dry-to-cooked usable yield and a cooked serving quantity.',
  ],
  [
    'Anjeer Smoothie',
    '28',
    'Ingredient list and method name different ice creams.',
    'Confirm the default ice cream before linking consumption.',
  ],
  [
    'Ferrero / Choco Oreo / Peanut Butter Oreo / Brownie / Snickers / KitKat thickshakes',
    '29–32',
    'Several methods add chocolate ice cream or syrup not present in their ingredient lists.',
    'Resolve each recipe independently; do not copy a common base without review.',
  ],
];
export default async function SopPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock');
  return (
    <main>
      <p>
        <Link href="/stock/ops/recipes">← Recipes & serving standards</Link>
      </p>
      <p className="eyebrow">Central admin · SOP review</p>
      <h1>SOP standards & readiness</h1>
      <p>
        <Link href="/stock/ops/sop/chef">Create chef workbook & review saved SOPs →</Link>
      </p>
      <p className="page-intro">
        T VANAMM SOP new changes pdf.pdf · 40 pages · reviewed 16 September 2026. These are source
        findings, not published stock-consumption recipes.
      </p>
      <section className="card">
        <span className="badge">Explicit source quantities</span>
        <h2>Standards already written in your SOP</h2>
        <p className="muted">
          These values can be retained as written. They are not complete, published consumption
          recipes.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Documented quantity</th>
                <th>Still needed before publishing</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  'Dum tea',
                  '1 L milk + 30 g tea + 70 g sugar (scales to 3 L / 5 L)',
                  'Usable finished yield and serving size',
                ],
                [
                  'Filter coffee decoction',
                  '200 g powder + 1,000 ml water',
                  'Usable decoction yield; exact serving quantities',
                ],
                [
                  'Strawberry milkshake',
                  '30 ml strawberry crush',
                  'Milk, scoop weight and finished serving',
                ],
                [
                  'Banana / litchi / pineapple milkshake',
                  '60 ml crush',
                  'Other ingredients and finished serving',
                ],
                ['Fries', '150 g portion', 'Oil, seasoning and packaging quantities'],
                [
                  'Veg / chicken nuggets',
                  '8 pieces per portion',
                  'Cooking and packaging quantities',
                ],
              ].map(([name, quantity, pending]) => (
                <tr key={name}>
                  <td>
                    <strong>{name}</strong>
                  </td>
                  <td>{quantity}</td>
                  <td>{pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="card">
        <h2>Before a recipe goes live</h2>
        <p>
          Confirm its serving size, measured finished yield, ingredient-specific spoon/scoop
          conversions, packaging and any ingredient alternatives. Each published version preserves
          the measurements used by future bills.
        </p>
        <Link className="btn" href="/stock/ops/recipes">
          Open recipe editor
        </Link>
      </div>
      <h2>Resolve these conflicts first</h2>
      {conflicts.map(([name, pages, issue, action]) => (
        <details className="card" key={name}>
          <summary>
            <strong>{name}</strong> · pages {pages} · Needs clarification
          </summary>
          <p>{issue}</p>
          <p>
            <strong>Next step:</strong> {action}
          </p>
        </details>
      ))}
      <h2>Review by category</h2>
      <div className="workflow-grid">
        {sections.map(([name, pages, notes]) => (
          <section className="card" key={name}>
            <p className="eyebrow">Pages {pages}</p>
            <h3>{name}</h3>
            <p>{notes}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
