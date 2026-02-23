# Iron Hand App - System Overview (for GPT context)

This document is a concise, accurate overview of the Iron Hand app so another GPT can understand the product, portals, and data flow well enough to propose changes that propagate correctly across the app.

## Product Summary
Iron Hand is a multi-portal operations platform for store owners, managers, employees, and surveillance staff. It is a Next.js web app packaged for iOS via Capacitor and deployed on Vercel. Data is stored in Supabase. The UI is a premium dark theme with rounded cards, subtle borders, and consistent spacing.

The app is organized into role-based portals. Each portal has its own primary responsibilities but shares certain styles, components, and backend records.

## Roles and Portals

### 1) Owner Portal
Purpose: Owners view operational reports across stores, initiate investigations, and manage access.

Key sections (in current UI):
- Header card: Owner name/role and store count + Settings + Sign out.
- Reports section with tabs:
  - Shift Reports
  - Full Day Reports
- Surveillance section (separate from Reports).
- Advanced section (Owner Controls + filters + date range + files list).

Shift Reports (Owner view)
- Data: per-employee shift deltas (SCR/CASH/NET) for a selected store + date or date range.
- Columns: NAME | SCR | CASH | NET | ACTION (Investigate button).
- Investigate opens the case modal (threaded conversation with manager).

Full Day Reports (Owner view)
- Data: per-store daily totals (SCR, LOTTO, STORE, GROSS, ATM, LOTTO P/O, CASH, DEPOSIT).
- Investigate opens the case modal (threaded conversation with manager) using the same shell as Shift Reports.

Surveillance (Owner view)
- Shows routine surveillance report and incident items (Critical/Theft/Incident).
- Routine has View Summary and Investigate actions.
- Incidents have Review and Investigate actions.
- Investigate opens a surveillance-specific case modal (UI-only unless backend exists).

Advanced (Owner view)
- Owner Controls: reset filters, add store with owner code, generate employee code, active employees.
- Filters: Store, Category, Employee.
- Date Range (From/To): required to load files.
- Files list renders directly below date range, then Owner Controls below.
- File viewer opens a modal preview of images/videos.

### 2) Manager Portal
Purpose: Managers submit daily numbers and respond to investigations.

Key actions:
- Submit Shift Reports (end-of-shift numbers for employees).
- Submit Full Day Report (store totals).
- View investigation tasks from Owner (Shift + Full Day).
- Respond in investigation thread.

### 3) Employee Portal
Purpose: Employees upload shift packages and files (photos/videos).

Key actions:
- Upload shift media (scratcher count, cash count, sales report photo, etc.).
- These uploads appear under Owner Advanced > Files list.

### 4) Surveillance Portal
Purpose: Surveillance staff submit routine daily reports and incident reports.

Key actions:
- Submit Routine Surveillance Report (text summary, optional attachment).
- Submit Incident reports (with category, timestamp, attachments).
- Owner sees these in the Surveillance section.

### 5) Iron Hand (Admin) / Master Portal
Purpose: Global management and monitoring across the system.

Key actions:
- View store roster, access, and global summaries.
- Manage platform-level data.

## Core Data Flows

### Reports
- Managers submit Shift Reports and Full Day Reports.
- Owner Portal reads these reports by store + date (or date range).
- When no report exists for current date, the UI can show the most recent available report (Shift + Full Day sections).

### Investigations
- Shift + Full Day Investigations are tied to Manager portal workflows.
- Investigate opens a case modal with a thread and status pill.
- Investigation messages persist (for Shift/Full Day), and managers can reply.
- Do not route surveillance investigations to manager endpoints.

### Surveillance
- Surveillance reports are separate from Manager reports.
- Owner can view routine report + incidents by store/date.
- If no surveillance investigation API exists, the modal is UI-only and send actions should be disabled ("Setup required").

### Advanced Files
- Files are loaded by filters and date range.
- Records list is visible only after date range is selected.
- File viewer opens centered with a dark overlay and provides image/video preview.

## UX/Design System Guidelines
- Dark navy theme, premium look.
- Rounded cards, subtle borders, soft glow.
- Consistent spacing (8/12/16/24) and aligned headers.
- Inputs/buttons should be slim and aligned across sections.
- iOS: input font size >= 16px to avoid zoom.
- Modal behavior: centered, blocking overlay, background scrolling disabled.

## Technical Notes
- Framework: Next.js 16, React 19.
- Deploy: Vercel, production at ironhand.net.
- Backend: Supabase for data.
- Mobile: Capacitor iOS wrapper around web UI.

## Safety/Change Constraints (Critical)
- Do NOT change or remove backend routes unless explicitly instructed.
- Do NOT change DB schema without approval.
- Do NOT break existing portal behavior.
- Keep Manager investigations separate from Surveillance investigations.
- UI changes should preserve existing logic and data flow.

## Recommended Prompting Style for GPT Changes
When requesting changes, specify:
- Which portal (Owner/Manager/Employee/Surveillance/Admin).
- Which section (Reports, Surveillance, Advanced, etc.).
- Whether change is UI-only or includes data wiring.
- Any constraints ("do not alter logic", "no new endpoints", etc.).

Example:
"Owner Portal > Reports > Shift Reports: adjust column spacing, keep data logic unchanged, maintain Investigate workflow, deploy to Vercel."

## Glossary
- Shift Report: per-employee end-of-shift deltas (SCR/CASH/NET).
- Full Day Report: per-store totals (SCR, LOTTO, STORE, GROSS, ATM, LOTTO P/O, CASH, DEPOSIT).
- Surveillance Routine: daily summary from surveillance.
- Incident: event report (Critical/Theft/Incident).
- Advanced Files: media uploads tied to date range and filters.

---
Last updated: 2025-12-30
