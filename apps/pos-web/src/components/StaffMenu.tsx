'use client';
import { StaffAttendance } from './StaffAttendance';
import { SessionControls } from '@/app/session-controls';

export function StaffMenu() {
  return (
    <details className="staff-menu">
      <summary>Staff menu</summary>
      <div className="staff-menu-content">
        <a href="/pos/printer">Printer setup</a>
        <a href="/help">Help &amp; daily guide</a>
        <SessionControls />
        <StaffAttendance />
      </div>
    </details>
  );
}
