'use client';
import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
  /** CSS table column width, e.g. "160px" or "minmax(120px, 1fr)". */
  width?: string;
  /** Truncate to one line with an ellipsis + hover title. */
  nowrap?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  isRowActive?: (row: T) => boolean;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}

const NO_SORT = { key: '', dir: 'asc' as const };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isRowActive,
  empty,
  initialSort,
}: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>(initialSort ?? NO_SORT);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    const sv = col?.sortValue;
    if (!sv) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [rows, sort, columns]);

  function toggle(key: string) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }

  return (
    <div className="table-wrap">
      <table className="dt">
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort.key === c.key && !!c.sortValue;
              return (
                <th
                  key={c.key}
                  className={`${c.align === 'right' ? 'num' : ''} ${c.sortValue ? 'dt-sortable' : ''}`}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={c.sortValue ? () => toggle(c.key) : undefined}
                >
                  {c.header}
                  {c.sortValue ? (
                    <span className="dt-arrow">
                      {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`${onRowClick ? 'dt-click' : ''} ${isRowActive?.(row) ? 'dt-active' : ''}`}
            >
              {columns.map((c) => {
                const content = c.render(row);
                return (
                  <td
                    key={c.key}
                    className={`${c.align === 'right' ? 'num' : ''} ${c.nowrap ? 'dt-ellipsis' : ''}`}
                    title={c.nowrap && typeof content === 'string' ? content : undefined}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                {empty ?? 'Nothing to show.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
