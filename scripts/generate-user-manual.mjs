import { readFile, mkdir, writeFile } from 'node:fs/promises';

const guides = JSON.parse(
  await readFile(new URL('../packages/ui/src/help.json', import.meta.url), 'utf8'),
);
const directory = new URL('../docs/manual/', import.meta.url);
await mkdir(directory, { recursive: true });
const index = [
  '# T VANAMM user manual',
  '',
  'Step-by-step guides for the business workspace and billing app. The same instructions are available from Help in the application. Each guide explains where to go, what the feature does and how to use it.',
  '',
  '## Choose your role',
  '',
];
for (const [role, guide] of Object.entries(guides)) {
  const filename = `${role.replaceAll('_', '-')}.md`;
  index.push(`- [${guide.title}](${filename})`);
  const lines = [`# ${guide.title}`, '', guide.intro, '', '[Back to all guides](README.md)', ''];
  for (const section of guide.sections) {
    lines.push(`## ${section.title}`, '', `**Where:** ${section.where}`, '', section.purpose, '');
    section.steps.forEach((step, n) => lines.push(`${n + 1}. ${step}`));
    if (section.note) lines.push('', section.note);
    lines.push('');
  }
  await writeFile(new URL(filename, directory), lines.join('\n'));
}
index.push(
  '',
  '## Daily responsibilities',
  '',
  '| Task | Who records it | Who reviews it |',
  '| --- | --- | --- |',
  '| Opening cash and sales | Working employee | Owner / accounts |',
  '| Milk and permitted local purchases | Employee who bought them | Owner |',
  '| Wastage | Employee who observed the loss | Owner |',
  '| Physical stock count | Employee who measured the stock | Another authorised reviewer |',
  '| Company-supplied goods | Outlet orders; receiving staff confirms arrival | Owner / supply team |',
  '| Shift expenses and closing cash | Working employee | Owner / accounts |',
  '| Recipe measurements and publication | Authorised central team | Authorised central team |',
  '',
  '## Stock and expense example',
  '',
  'An employee buys 5 litres of milk for ₹325 and records one Local purchase. Stock increases by 5 litres and a linked ₹325 expense is recorded. If 0.5 litres spills, the employee records 0.5 litres as wastage with a reason. Later, a physical count records the quantity actually remaining; it must not deduct that same spill again. Recipe-linked sales usage updates separately when configured and synced.',
  '',
  '## Maintaining this manual',
  '',
  'The source is `packages/ui/src/help.json`. After editing it, run `node scripts/generate-user-manual.mjs`, then format the generated Markdown. Do not put credentials, OTPs, PINs or API keys into the manual.',
  '',
);
await writeFile(new URL('README.md', directory), index.join('\n'));
