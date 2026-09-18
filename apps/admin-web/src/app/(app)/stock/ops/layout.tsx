import type { ReactNode } from 'react';
import { SupplyNavigation } from './supply-navigation';
export default function SupplyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="supply-shell">
      <aside className="supply-sidebar">
        <p className="eyebrow">Supply operations</p>
        <h2>Keep outlets ready</h2>
        <SupplyNavigation />
      </aside>
      <div className="supply-content">{children}</div>
    </div>
  );
}
