# Design

## Overview

This design direction supports a static docs-site prototype for `@async/db`. The surface is a brand/docs experience, not the built-in `/__db` product viewer. It should feel like a dark-blue technical atlas: calm, exact, developer-native, and visually rich through code/data artifacts rather than stock imagery.

The prototype and public docs pages use Tailwind utility classes and the Tailwind v4 browser CDN only. They have no custom stylesheet and no build step. Dark mode is the default; light mode is available through a small toggle that switches a root `light` class.

Public docs pages should explain `@async/db` behavior only. Hosting mechanics, design-process notes, chat context, and implementation instructions belong outside visible page copy.

## Color Palette

Use OKLCH tokens in implementation.

| Token | Value | Use |
| --- | --- | --- |
| `--blue-ink` | `oklch(13% 0.055 255)` | Page background |
| `--blue-deep` | `oklch(18% 0.07 252)` | Section bands and large surfaces |
| `--blue-panel` | `oklch(22% 0.075 250)` | Panels, code wells, diagram regions |
| `--blue-line` | `oklch(40% 0.08 248)` | Hairlines and separators |
| `--text-main` | `oklch(94% 0.018 235)` | Primary copy |
| `--text-muted` | `oklch(76% 0.04 235)` | Secondary copy |
| `--cyan` | `oklch(78% 0.16 208)` | Primary accent, focus, active states |
| `--mint` | `oklch(79% 0.14 162)` | Success, generated outputs, JSON store |
| `--amber` | `oklch(83% 0.16 82)` | Warnings, migration/graduation emphasis |
| `--rose` | `oklch(72% 0.17 24)` | Error or risk states |

The page may be dark blue overall, but the accents must break one-hue monotony. Avoid purple gradients and blue-on-blue low contrast.

## Typography

- Use a system sans stack for headings, UI labels, and body text: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Use a system mono stack for fixtures, commands, generated types, and route examples.
- Keep display type tight but not cramped. Do not use negative letter spacing beyond `-0.03em`.
- Body copy should stay within `65ch` where possible. Code/data panels may scroll horizontally when preserving structure matters.

## Layout

- Use full-width dark-blue bands with constrained inner content.
- Do not nest cards. Use panels for individual artifacts such as code blocks, route previews, schema tables, and migration choices.
- Cards and panels should use 8px to 12px radii. Buttons can be pill-like only when they are compact tags or command chips.
- Prefer asymmetric artifact-led sections: a readable explanation beside a diagram, code stack, or route map.
- On mobile, preserve the reading order: promise, workflow artifact, steps, contracts, API preview, production paths, examples.

## Components

- Primary buttons: cyan border and dark fill, with clear hover and focus states.
- Secondary buttons: transparent or navy fill with visible border.
- Pills: compact labels for resource type, store, operation, or route.
- Code panels: mono text, strong line labels, line numbers only when they help sequence.
- Diagrams: use CSS grid, borders, arrows, and labels. No decorative blob backgrounds.
- Tables and matrices: high-contrast headings, restrained row lines, and accent-colored status labels.

## Motion

Use lightweight hover and focus transitions between 150ms and 220ms. Avoid large entrance choreography. Include `prefers-reduced-motion: reduce` to disable transforms and transitions.

## Accessibility

All text on dark surfaces must meet WCAG AA contrast. Focus rings use cyan with an offset or outline that remains visible on navy panels. The prototype must be readable at narrow mobile widths without overlapping labels, buttons, code, or panels.
