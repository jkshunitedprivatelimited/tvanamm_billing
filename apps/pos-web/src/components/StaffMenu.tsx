'use client';
import { StaffAttendance } from './StaffAttendance';
import { SessionControls } from '@/app/session-controls';

export function StaffMenu() {
  return (
    <details className="staff-menu">
      <summary>Staff menu</summary>
      <div className="staff-menu-content">
        <SessionControls />
        <StaffAttendance />
      </div>
    </details>
  );
}
