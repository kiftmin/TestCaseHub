---
name: Executive Precision
colors:
  surface: '#fcf8fa'
  surface-dim: '#dcd9db'
  surface-bright: '#fcf8fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f5'
  surface-container: '#f0edef'
  surface-container-high: '#eae7e9'
  surface-container-highest: '#e4e2e4'
  on-surface: '#1b1b1d'
  on-surface-variant: '#45464d'
  inverse-surface: '#303032'
  inverse-on-surface: '#f3f0f2'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#4648d4'
  on-secondary: '#ffffff'
  secondary-container: '#6063ee'
  on-secondary-container: '#fffbff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#2c0051'
  on-tertiary-container: '#ac59fb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#f0dbff'
  tertiary-fixed-dim: '#ddb7ff'
  on-tertiary-fixed: '#2c0051'
  on-tertiary-fixed-variant: '#6900b3'
  background: '#fcf8fa'
  on-background: '#1b1b1d'
  surface-variant: '#e4e2e4'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 28px
  body-base:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 0.25rem
  sm: 0.5rem
  md: 1rem
  lg: 1.5rem
  xl: 2.5rem
  container-max: 1440px
  gutter: 1rem
---

## Brand & Style

The design system is engineered for high-stakes UAT environments where data density and cognitive clarity are paramount. The aesthetic follows a **Corporate / Modern** approach, drawing heavily from functional minimalism to ensure the user's focus remains on test execution and reporting.

The target audience consists of Quality Assurance professionals and Project Managers who require a serious, efficient, and reliable interface. The UI evokes a sense of authority and institutional stability through a structured layout, limited but meaningful use of color, and high-fidelity interactive elements. Every visual decision is optimized to reduce eye strain during long-form data entry and technical review.

## Colors

The palette is anchored by **Deep Slate (#0f172a)**, providing a high-contrast foundation for navigation and structural components. **Indigo (#6366f1)** serves as the primary action color, signaling interactivity without causing visual fatigue.

Functional badges utilize specific accents to denote system roles: **Purple (#a855f7)** for Administrative high-level access and **Blue (#3b82f6)** for standard User roles. Backgrounds utilize a nuanced **Subdued Gray (#f8fafc)** to distinguish surface layers from the canvas, while pure white is reserved for content containers and input areas to maximize legibility.

## Typography

This design system utilizes a dual-font strategy to balance technical precision with readability. **Geist** is employed for headings, labels, and UI controls to leverage its geometric, developer-friendly clarity. **Inter** is used for all body text and data-heavy descriptions to ensure comfortable reading across long test case steps.

Letter spacing is tightened slightly on display sizes to maintain a compact, "high-fidelity" feel. Labels for status indicators and badges use a semi-bold weight in Geist to distinguish them clearly from surrounding body text.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for desktop dashboards to ensure predictable data visualization, switching to a fluid model for internal content areas. A strict 4px baseline grid governs all vertical rhythm.

- **Desktop (1280px+):** 12-column grid, 24px margins, 16px gutters. Sidebar is fixed at 280px.
- **Tablet (768px - 1279px):** 8-column grid, 16px margins, 16px gutters. Sidebar collapses to icons.
- **Mobile (<767px):** 4-column fluid grid, 16px margins. Navigation moves to a bottom bar or hamburger menu.

Data density is prioritized; use `sm` (8px) and `md` (16px) spacing for internal component padding to allow more information to be visible above the fold.

## Elevation & Depth

The system uses **Tonal Layers** combined with **Low-contrast outlines** to define hierarchy without visual clutter. 

1. **Floor:** The background canvas (#f8fafc).
2. **Surface:** White (#ffffff) cards and containers with a 1px border (#e2e8f0).
3. **Elevated:** Modals and dropdowns use a subtle ambient shadow (0px 4px 6px -1px rgba(15, 23, 42, 0.1)) to suggest lift.

Shadows must be "cold"—using the primary slate color for the tint rather than pure black—to maintain the professional atmosphere. Avoid heavy blurs; maintain crisp, defined edges.

## Shapes

The shape language is defined by **Rounded (0.5rem)** corners. This provides a modern, approachable feel while remaining structured enough for enterprise software. 

- **Standard Elements:** Buttons, inputs, and cards use `rounded-md` (0.5rem).
- **Large Containers:** Modals and main dashboard panels use `rounded-lg` (1rem).
- **Small Elements:** Tags, badges, and checkboxes use `rounded-sm` (0.25rem).

Interactive states (hover/active) do not change shape, only fill or border intensity, ensuring layout stability during rapid user interaction.

## Components

### Buttons
Primary buttons use the Indigo (#6366f1) fill with white text. Secondary buttons use a white fill with a Slate border. Ghost buttons are reserved for low-priority actions in tables.

### Chips & Badges
Badges are non-interactive status indicators. Use light background tints of the accent colors (e.g., Purple at 10% opacity) with high-contrast text for role identifiers.

### Input Fields
Inputs must have a defined 1px border (#e2e8f0) that shifts to Indigo (#6366f1) on focus. Labels are positioned above the field in Geist Medium, 12px.

### Lists & Tables
The core of the application. Rows should have a subtle hover state (#f1f5f9). Use horizontal dividers only; avoid vertical grid lines to maintain a modern look.

### Cards
Cards are the primary container for test case groups. They feature a 1px border and no shadow unless they are "active" or being dragged in a kanban view.

### Progress Indicators
For test execution, use a slim 4px progress bar. Use semantic colors: Green for Pass, Red for Fail, and Amber for Blocked, ensuring they are accessible via distinct icons as well as color.