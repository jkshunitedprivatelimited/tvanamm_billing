'use client';
import { AttendanceControl } from './AttendanceControl';
import { StaffAttendance } from './StaffAttendance';

export function StaffMenu() {
  return (
    <div className="staff-toolbar">
      <AttendanceControl />
      <details className="staff-menu">
        <summary>Team &amp; help</summary>
        <div className="staff-menu-content">
          <StaffAttendance />
          <a href="/help">Help &amp; daily guide</a>
        </div>
      </details>
    </div>
  );
}
