# GroundworX Component Rules
# Canonical UI Building Blocks

---

## Purpose

These rules translate the GroundworX visual direction into reusable component
behavior.

Use this when implementing app UI so the product feels like one system instead
of a collection of styled pages.

---

## 1. Topbar

Purpose:
- establish system posture
- show operational state
- keep brand present but not loud

Rules:
- compact height
- brand lockup on the left
- live/connected/admin chips on the right
- one dominant status item at most
- no oversized user menus

Topbar is an instrument rail, not a hero section.

---

## 2. Sidebar Navigation

Purpose:
- provide persistent orientation
- segment the product into operational zones

Rules:
- use section labels in mono uppercase
- use compact items with title + optional subtitle
- active state should be obvious but restrained
- active item can use signal border/edge treatment
- do not use giant icons or bulky nav cards

Navigation should feel structural, not decorative.

---

## 3. Metric Cards

Purpose:
- communicate system state or business-critical numbers fast

Rules:
- strong numeric hierarchy
- small mono labels
- one short explanatory line
- use edge/accent state markers instead of fully saturated backgrounds
- no gradient-heavy “executive dashboard” styling

Metric card color semantics:
- green = active/good/live
- amber = review/pending
- red = blocked/risk
- blue = system/neutral

---

## 4. Panels

Purpose:
- hold grouped work or information

Rules:
- panels should feel modular and precise
- compact header with title + small subtitle
- optional tool area on the right
- subtle header background shift is acceptable
- panel body should prioritize density and structure

Panels should feel like equipment modules, not floating cards.

---

## 5. Tables

Purpose:
- support repeated scanning, comparison, and operational review

Rules:
- sticky headers when useful
- mono uppercase headers
- compact row height
- hover states should be subtle
- status should appear inline, not require opening details
- use muted metadata below primary values when needed

Tables are a core part of the GroundworX feel.
They should feel engineered, not spreadsheet-ugly and not consumer-soft.

---

## 6. State Chips

Purpose:
- compress status into a fast scannable token

Rules:
- use mono uppercase
- include small dot when helpful
- keep padding tight
- never use giant pill badges

Canonical states:
- `live`
- `ready`
- `review`
- `queued`
- `blocked`
- `complete`
- `degraded`

---

## 7. Command Bars

Purpose:
- gather immediate operator actions near the work

Rules:
- compact button sizing
- mono uppercase labels
- one clearly primary action
- secondary actions should not compete visually
- avoid more than one brightly accented primary per bar

Command bars should feel decisive and calm.

---

## 8. Glint Panels

Purpose:
- surface machine-assisted recommendations without hijacking the interface

Rules:
- Glint outputs should look like intelligence inserts, not chatbot bubbles
- one featured insight panel is okay
- recommendations should include context and next action
- include confidence / reason / impact when possible
- Glint should augment operator judgment, not replace it visually

---

## 9. Audit Rows And Provenance

Purpose:
- make the system trustworthy

Rules:
- always favor visible provenance for automation-generated results
- timestamps, trigger source, and actor should be small but accessible
- mono styling is preferred
- audit cues should be consistent across settings, overnight jobs, and generated artifacts

Trust is part of the visual system.

---

## 10. Overnight Jobs Surfaces

Purpose:
- make unattended work visible, durable, and reviewable

Rules:
- queued/running/review/blocked/complete must be visually distinct
- every job row/card should show:
  - type
  - status
  - artifact/result
  - owner/source
  - time context
- failures should not be buried
- morning summary should feel like an operator review surface, not raw logs

This is a signature GroundworX surface.

---

## 11. Forms And Settings

Purpose:
- make configuration feel secure and operational

Rules:
- provider/setup forms should emphasize:
  - state
  - verification
  - last changed / last verified
  - auditability
- inputs should be precise and compact
- secrets should never visually appear casual or consumer-like
- settings must feel “admin console,” not “preferences page”

---

## 12. Empty States

Purpose:
- keep the app calm and useful when no data is present

Rules:
- no cartoonish illustrations
- no generic AI copy
- explain what is missing
- explain what action unlocks the next state
- keep tone direct and operational

---

## 13. Mobile Behavior

Purpose:
- preserve the system feel on smaller screens

Rules:
- collapse side rails before collapsing meaning
- preserve state visibility
- stack panels cleanly
- keep actions reachable
- avoid turning dense screens into oversized card piles

Mobile should still feel like GroundworX, not a stripped-down toy version.

---

## 14. Anti-Patterns

Do not ship:
- giant glowing neon panels
- soft glassmorphism everywhere
- over-rounded card farms
- decorative data tiles with no utility
- generic AI assistant chat layouts as core workflow
- excessive green borders on everything
- noisy animation layers in the product shell

---

## 15. Implementation Rule

When uncertain, prefer:
- more structure
- less decoration
- stronger hierarchy
- tighter spacing
- quieter color usage

If a screen feels faster to scan and more trustworthy, it is probably moving in
the right direction.
