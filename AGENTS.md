# Project Guidelines — DCF Valuation Dashboard

## Mandatory Feature & UI Upgrade Workflow

For every new feature, enhancement, or UI/UX improvement requested on this repository, follow this 3-stage workflow strictly **before writing or editing code**:

1. **Planning**: Write a detailed implementation plan (engine formulas, UI/UX layout for Desktop & iPhone, files to modify, and verification plan). Always preserve 100% spreadsheet DCF parity on the 15 presets unless the user explicitly asks to change defaults.
2. **Visual Mockup**: Generate a visual UI mockup image (Desktop and/or iPhone as applicable) so the user can inspect the proposed layout and styling directly. Wait for explicit user approval on both the plan and the mockup.
3. **Execution & Verification**: Only after the user approves, implement the changes, run `npm test` and `npm run build` (plus Playwright `393×852` iPhone & `1280×800` Desktop visual checks for UI changes), and push to `origin main`.
