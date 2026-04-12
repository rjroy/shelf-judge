---
status: active
custom_directories:
  art: [current]
  generated: [current]
  mockups: [current]
  commissions: [pending, active, completed, abandoned]
  meetings: [open, closed, deferred]

filename_exemptions:
  - "^commission-.+-\\d{8}-\\d{6}\\.md$"
  - "^audience-.+-\\d{8}-\\d{6}.*\\.md$"

custom_fields:
  commissions: [worker, workerDisplayTitle, prompt, dependencies, linked_artifacts]
  meetings: [worker, workerDisplayTitle, workerPortraitUrl, agenda, deferred_until, meeting_log]
  issues: [modules]
---

# Project Lore Configuration

This file tells `/tend` what's intentional about this project's `.lore/` structure.

## Custom issue statuses

Issues in this project use three statuses beyond the schema defaults:

- **approved**: Accepted for work, will be addressed
- **parked**: Recognized as valid, not currently planned
- **declined**: Question was answered "no", or issue was rejected

## Custom directories

- `art/` - Static visual assets (logos, etc.)
- `generated/` - AI-generated images
- `mockups/` - HTML mockup files for visual direction and UI prototyping

## Filename exemptions

Commission and meeting filenames are machine-generated with timestamps as unique identifiers. They follow the pattern `commission-Worker-YYYYMMDD-HHMMSS.md` and `audience-Worker-YYYYMMDD-HHMMSS.md`.
