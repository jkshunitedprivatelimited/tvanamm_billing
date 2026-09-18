'use client';
import { AttendanceControl } from './AttendanceControl';
import { StaffAttendance } from './StaffAttendance';
import { SessionControls } from '@/app/session-controls';

export function StaffMenu() {
  return (
    <div className="staff-toolbar">
      <AttendanceControl />
      <details className="staff-menu">
        <summary>Team &amp; help</summary>
        <div className="staff-menu-content">
          <StaffAttendance />
          <SessionControls />
          <a href="/help">Help &amp; daily guide</a>
        </div>
      </details>
    </div>
  );
}
