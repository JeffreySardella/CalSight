# Design System Strategy: The Editorial Authority

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Ledger."** 

Moving away from the cluttered, "widget-heavy" feel of traditional government dashboards, this system treats civic data with the reverence of a high-end financial journal or a premium broadsheet. We achieve an authoritative aesthetic not through heavy borders or loud primary colors, but through extreme typographic discipline, intentional whitespace, and a "tonal layering" approach that feels architectural rather than digital. 

The goal is to move beyond "standard UI" by embracing a sophisticated, editorial layout where information is prioritized through scale and subtle background shifts rather than containers and lines.

## 2. Colors: The Tonal Atmosphere
This palette is designed to feel calm, permanent, and transparent. We use muted slates and cool grays to establish a sense of institutional stability.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using `1px solid` borders to define sections or cards. 
Structure must be achieved through:
- **Background Color Shifts:** Use `surface-container-low` for secondary content sitting on a `surface` background.
- **Vertical Rhythm:** Utilize the Spacing Scale (e.g., `spacing-12` or `spacing-16`) to create distinct content "zones."

### Surface Hierarchy & Nesting
Treat the dashboard as a series of stacked, fine-paper sheets. 
- **Base Layer:** `surface` (#fcf8f9).
- **Primary Content Blocks:** `surface-container-lowest` (#ffffff). These should feel like elevated sheets of paper.
- **Background Accents:** `surface-container` (#f0edef) for sidebars or secondary navigation to provide a grounded, recessed feel.

### The "Glass & Gradient" Rule
To avoid a "flat" government feel, use a subtle **Signature Texture**:
- Apply a linear gradient from `primary` (#575f6b) to `primary-container` (#dce3f2) at a low 5% opacity for large hero backgrounds.
- For floating navigation or "quick-view" modals, use a backdrop-blur (12px) with a semi-transparent `surface_bright` to create a "frosted glass" effect, allowing data visualizations to bleed through softly.

## 3. Typography: Authoritative Clarity
The system pairs the humanist stability of **Public Sans** with the technical precision of **Inter**.

- **Display & Headlines (Public Sans):** Used for data storytelling. High-contrast sizing (e.g., `display-lg` vs `headline-sm`) creates a clear entry point for the eye. The large scale conveys importance without needing "Bold" weights.
- **Body & Labels (Inter):** Used for the "fine print" and data metadata. Inter’s high x-height ensures legibility in dense data tables and small labels.
- **The Hierarchy Rule:** Use `on_surface_variant` (#5f5f61) for secondary descriptions and `on_surface` (#323235) for primary data points to ensure the user’s eye hits the most important numbers first.

## 4. Elevation & Depth
In "The Digital Ledger," depth is perceived through light and material, not artificial shadows.

### The Layering Principle
Achieve a "Soft Lift" by stacking tiers:
- Place a `surface-container-lowest` card (the "Paper") on a `surface-container-low` background (the "Table"). This 1-step shift in value creates enough contrast for the eye to perceive a boundary without a border.

### Ambient Shadows
If a floating element (like a filter popover) is required:
- **Shadow:** Use a large blur (32px) with 4% opacity. 
- **Shadow Tint:** Use the `on_surface` color as the shadow base to ensure the shadow looks like natural ambient occlusion rather than a "glow."

### The "Ghost Border" Fallback
If contrast fails (e.g., in high-glare environments), use a "Ghost Border":
- Token: `outline-variant` (#b2b1b4) at **15% opacity**. This creates a suggestion of a boundary that disappears into the background upon closer inspection.

## 5. Components: Refined Utility

### Buttons & CTAs
- **Primary:** Filled with `primary` (#575f6b), text in `on_primary` (#f6f7ff). Use `rounded-md` (0.375rem) for a professional, slightly sharpened look.
- **Secondary:** Use `primary_container` (#dce3f2) with no border. The low-contrast fill makes it feel integrated into the "paper" layer.

### Input Fields
- Avoid "box" inputs. Use a "Bottom-Line Only" approach or a very subtle `surface-container-high` fill with a `rounded-sm` top. 
- **Error State:** Use `error` (#9f403d) for text, but use `error_container` (#fe8983) at 20% opacity as a soft background wash behind the input.

### Data Visualization Cards
- **Forbid Dividers:** Do not use lines to separate data points. Use `spacing-5` (1.1rem) of gutter space.
- **The "Highlight" Chip:** Use `tertiary_container` (#dcddfe) for data tags or status indicators. It provides a cool, sophisticated contrast to the primary blue-grays.

### Sophisticated List Items
- Instead of a line between items, use a subtle hover state: transition the background to `surface-container-highest` (#e3e2e4) with a `rounded-md` corner.

## 6. Do’s and Don’ts

### Do
- **Do** use `display-lg` for the "Hero Metric" (e.g., total budget, population). Let the typography do the heavy lifting.
- **Do** use `rounded-lg` for large layout containers and `rounded-sm` for interactive elements like buttons to create a "Macro-Soft/Micro-Sharp" aesthetic.
- **Do** maximize whitespace. If a section feels crowded, increase spacing using `spacing-10` or `12`.

### Don’t
- **Don't** use pure black (#000000). Always use `on_surface` (#323235) to maintain the soft, editorial ink-on-paper feel.
- **Don't** use standard "Drop Shadows." If an element needs to stand out, use a tonal shift or a "Ghost Border."
- **Don't** use vibrant, saturated colors for data viz. Use the `primary`, `secondary`, and `tertiary` tiers to keep the dashboard looking authoritative and non-distracting.