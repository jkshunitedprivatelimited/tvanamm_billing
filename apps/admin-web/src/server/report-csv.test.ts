import { expect, it } from 'vitest';
import { reportCsv } from './report-csv';
it('quotes names and prevents spreadsheet formula execution', () => {
  const csv = reportCsv([{ name: '=SUM(A1:A2)', amount: '-12.50', note: 'Milk, "daily"' }]);
  expect(csv).toContain('"\'=SUM(A1:A2)"');
  expect(csv).toContain('"-12.50"');
  expect(csv).toContain('"Milk, ""daily"""');
});
it('exports missing values as empty, without inventing zero', () => {
  expect(reportCsv([{ quantity: null }])).toBe('\ufeff"quantity"\r\n""');
});
