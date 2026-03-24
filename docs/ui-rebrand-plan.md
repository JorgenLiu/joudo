# Joudo UI Rebrand Plan

## Direction

Joudo adopts a single cross-surface design direction:

- Quiet Sanctuary
- calm, controlled, low-noise
- product language built around trust, boundaries, and recoverability

This direction is intended to replace two current mismatches:

- the desktop control panel feels like a pleasant utility sheet, but not yet like a local control center
- the mobile web UI feels like an engineering console, but not yet like a finished product surface

## Locked Decisions

These decisions are now fixed unless a later explicit change is made:

1. Brand / UI direction: Quiet Sanctuary
2. Primary product icon direction: Bridge Seal
3. Brand mark direction: Enso Gate

## Product Role Split

Joudo has two surfaces with different jobs. The redesign should not blur them.

### Desktop

Role:

- local control center
- bridge lifecycle
- mobile access bootstrap
- TOTP and repo governance

Primary user question:

- is the local system healthy and ready for phone access?

### Mobile Web

Role:

- task execution surface
- approval handling
- session outcome review
- policy and history governance

Primary user question:

- what is the agent doing right now, and what do I need to decide next?

## Visual Language

### Tone

- still
- grounded
- precise
- protective
- not futuristic, not chatty

### What To Avoid

- editor theme mimicry
- purple or blue AI-gradient branding
- cyberpunk glow
- terminal nostalgia
- soft wellness aesthetics

### Palette

Primary palette:

- Ink Moss: `#13211E`
- Deep Grove: `#20332F`
- Sage Metal: `#5E7E72`
- Mist Stone: `#D8DED5`
- Rice Paper: `#F3F0E8`

Functional accents:

- Copper Signal: `#B88A4A`
- Ember Warning: `#A05547`
- Guard Green: `#6C9A78`
- Slate Info: `#7C8F96`

### Typography

Recommended pairing:

- Display: Fraunces or Instrument Serif
- Body: Manrope or IBM Plex Sans
- Mono: IBM Plex Mono

Typography rules:

- display only for product title, section hero titles, and high-level status blocks
- body sans for all operational UI
- mono only for paths, ports, secrets, URLs, and machine-shaped values

## Shared Design System

Both desktop and mobile should use the same semantic tokens.

### Surface Tiers

- `surface-base`: app background
- `surface-panel`: standard cards
- `surface-raised`: high-importance modules
- `surface-danger`: destructive or high-risk states

### Status Semantics

- running
- awaiting-approval
- recovering
- timed-out
- disconnected
- authenticated
- unauthenticated

Each status should have:

- one color family
- one label tone
- one icon shape language
- one badge treatment

### Card Types

- hero card
- control card
- approval card
- summary card
- governance card
- warning card

## Desktop IA Proposal

### Order

1. system header
2. bridge hero card
3. access module
4. repo governance module
5. secondary diagnostics / help copy

### Header Content

- Joudo brand mark
- Local Control Center label
- current overall health

### Bridge Hero Card

Must dominate the screen.

Contents:

- current state
- managed vs external source
- port / pid
- primary start/stop action
- last failure summary if present

### Access Module

Combine current LAN and TOTP concepts into one section.

Subsections:

- phone access URL
- TOTP pairing state
- copy / rebind actions

### Repo Governance Module

Contents:

- repo select
- agent select
- init policy
- remove repo
- current governance state

## Mobile IA Proposal

### Tabs

Keep the current functional split, but tighten the semantics:

1. Console
2. Outcome
3. Policy
4. History

### Console

Order:

1. current context header
2. prompt card
3. approval card
4. latest session snapshot preview
5. current warning / error block

### Outcome

Order:

1. session outcome header
2. summary hero
3. step stream
4. command / files / checks / risks clusters
5. next action

### Policy

Order:

1. policy overview hero
2. recent persisted rule banner
3. write / shell / read rule groups
4. repo notes
5. validation results

### History

Order:

1. current session state
2. recoverable sessions
3. clear history action
4. recovery explanation

## Motion

Motion should be sparse and meaningful.

Use:

- gentle load fade and rise for hero modules
- tab transition based on opacity and slight vertical motion
- explicit approval appearance animation

Avoid:

- decorative micro-animations everywhere
- bouncing status pills
- continuous shimmer outside skeleton loading

## Implementation Order

1. establish tokens, typography, and icon set
2. rebuild desktop header and bridge hero card
3. rebuild mobile shell, hero, and tab bar
4. rebuild Console and Outcome pages
5. rebuild Policy and History pages
6. replace app icons, tray icon, and brand mark assets

## Acceptance Criteria

The redesign is successful when:

1. desktop and mobile clearly look like the same product
2. the first-screen hierarchy makes the current state obvious
3. approvals and risks are more visually legible than today
4. brand recognition no longer depends on the wordmark alone
5. no functionality is removed or hidden behind extra steps