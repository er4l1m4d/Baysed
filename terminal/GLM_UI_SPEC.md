# Baysed Terminal — UI Design Spec for GLM 5.3

This document is a pixel-accurate description of a dark-themed quantitative research terminal. The UI has a **left sidebar** (collapsible) and a **main content area**. Every visual detail below is exact — follow it precisely.

---

## 1. Global Theme

- **Background**: Pure near-black `#09090b` (zinc-950)
- **Card surface**: Slightly lighter `#18181b` (zinc-900)
- **Card border**: Thin 1px `#27272a` (zinc-800)
- **Sidebar background**: Same as page background `#09090b`, or slightly lighter `#0f0f12`
- **Accent color**: Warm gold/amber `#F59E0B` — used for active nav items, icons, links, highlights, button backgrounds
- **Accent hover**: Lighter gold `#FBBF24`
- **Text primary**: White `#FAFAFA`
- **Text secondary**: `#A1A1AA` (zinc-400)
- **Text muted**: `#71717A` (zinc-500)
- **Positive/desired value**: Emerald green `#10B981`
- **Negative/caution value**: Rose red `#F43F5E`
- **Border radius on cards**: 12px (large) or 8px (small)
- **Border radius on buttons/pills**: Full rounded (9999px)
- **Font family**: Inter (or system sans-serif fallback: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)
- **Shadow on cards**: None — flat design, depth comes from background color difference only
- **Overall padding**: 24px gap between sidebar and main content; 24px internal padding in the main content area

---

## 2. Layout Structure

```
┌──────────┬─────────────────────────────────────────────────────┐
│          │  Header (search + user avatar)                      │
│ Sidebar  │─────────────────────────────────────────────────────│
│ (fixed   │                                                     │
│  left)   │  Page Title + Subtitle                              │
│          │                                                     │
│          │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │
│          │  │ Card │ │ Card │ │ Card │ │ Card │  ← 4-column  │
│          │  └──────┘ └──────┘ └──────┘ └──────┘    grid       │
│          │                                                     │
│          │  ┌────────────────────────┐ ┌──────────────────┐   │
│          │  │                        │ │                  │   │
│          │  │  Brier Score Chart     │ │  Live Market     │   │
│          │  │  (wide)                │ │  Details         │   │
│          │  │                        │ │  (narrow)        │   │
│          │  └────────────────────────┘ └──────────────────┘   │
│          │                                                     │
│          │  ┌────────────────────────┐ ┌──────────────────┐   │
│          │  │                        │ │                  │   │
│          │  │  Observation Snapshots │ │  Resolution Feed │   │
│          │  │  (wide)                │ │  (narrow)        │   │
│          │  │                        │ │                  │   │
│          │  └────────────────────────┘ └──────────────────┘   │
│          │                                                     │
└──────────┴─────────────────────────────────────────────────────┘
```

**Key layout rules:**
- The sidebar is **fixed position** (does not scroll with content)
- The main content area is **scrollable** (vertical scroll)
- The main content has a **max-width of 1200px** with auto centering, or fills the remaining space after sidebar
- Cards use a **2-column grid**: left column takes ~65% width, right column ~35%
- The 4 top cards are a **single row, equal-width 4-column grid**

---

## 3. Sidebar (Collapsible)

### Expanded state (default): 240px wide

```
┌─────────────────────┐
│                     │
│  ☀ BAYSED           │  ← Logo area
│                     │
│  ◻ Overview         │  ← Active (gold background pill behind it)
│  ◻ Predictions      │
│  ◻ Live Market      │
│  ◻ Calibration      │
│  ◻ Resolution       │
│  ◻ Settings         │
│                     │
│                     │
│  ◀ ◀ (collapse btn) │  ← At the very bottom
│                     │
└─────────────────────┘
```

### Collapsed state: 64px wide

```
┌────┐
│    │
│ ☀  │  ← Just the logo icon (no text)
│    │
│ ◻  │  ← Just icons, no text
│ ◻  │
│ ◻  │
│ ◻  │
│ ◻  │
│ ◻  │
│    │
│ ▶▶ │  ← Expand button
│    │
└────┘
```

### Sidebar detailed styling:
- **Width expanded**: 240px
- **Width collapsed**: 64px
- **Background**: `#09090b` (same as page, seamless look) OR `#0f0f12` (barely distinguishable)
- **Transition**: Smooth 200ms ease-out when toggling
- **Logo area**: At the very top, 56px tall. Contains:
  - A small gold/amber icon (use a simple geometric shape — diamond, hexagon, or chart icon) to the left
  - "BAYSED" text to the right of the icon in bold uppercase, letter-spacing 2px, white color, 14px font
  - When collapsed: only the icon, no text
- **Nav items**: Stacked vertically starting 32px below the logo
  - Each item is a horizontal flex container, 44px tall, with:
    - Left padding 20px (when expanded)
    - An SVG icon, 20x20px, color `#71717A` (inactive) or `#F59E0B` (active)
    - Text label, 14px font, weight 500, color `#71717A` (inactive) or `#FAFAFA` (active)
    - 12px gap between icon and text
  - **Active item**: Has a rounded pill background behind it — `#F59E0B` at 10% opacity, with the icon colored gold `#F59E0B` and text white
  - **Hover state**: Background pill at `#F59E0B` at 5% opacity
  - When collapsed: items are centered horizontally in the 64px width, icon only, no text. A tooltip on hover shows the label.
- **Collapse/expand button**: At the very bottom of the sidebar. A small icon button, 32x32, chevron pointing left (expand: chevron pointing right). Color `#71717A`.

### Nav items (in order):
1. **Overview** — icon: grid/dashboard (4 squares)
2. **Predictions** — icon: brain or chart-line
3. **Live Market** — icon: radio signal or lightning bolt
4. **Calibration** — icon: target or crosshair
5. **Resolution** — icon: check-circle or flag
6. **Settings** — icon: gear/cog

---

## 4. Header Bar

**Location**: Top of main content area, fixed height 56px, full width of main content.

**Layout**: `justify-content: space-between` (logo-area left, search center-right, avatar far right)

```
│  Dashboard > Overview                        🔍 Search...  🔔  👤  │
```

- **Left side**: Breadcrumb text — "Dashboard > Overview" in 13px font, color `#A1A1AA`. The current page ("Overview") is slightly brighter `#FAFAFA`.
- **Right side**:
  - Search bar: 240px wide, 36px tall, rounded-full, background `#27272a`, border `#3F3F46`, with a search icon on the left and placeholder text "Search..." in `#71717A`. On focus, border turns to gold `#F59E0B`.
  - Bell icon (notification): 20px, color `#A1A1AA`
  - User avatar: 32x32 circle, can be a placeholder icon or colored circle with initials

---

## 5. Overview Page Content

### 5a. Page Title Section

Below the header, 24px padding top:

- **Title**: "Overview" — 28px font, weight 700, color white
- **Subtitle**: "System health across capital, agents, positions and market regime." — 14px font, weight 400, color `#A1A1AA`, 8px below title

### 5b. Summary Cards Row (4 cards)

A single row of 4 equally-spaced cards. Each card is identical in structure.

**Card structure:**
```
┌─────────────────────────────────┐
│                                 │
│  TOTAL PREDICTIONS              │  ← Label: 11px, uppercase, letter-spacing 1px, color #71717A, weight 600
│  97                             │  ← Value: 32px, weight 700, color white
│  +12 since last cycle           │  ← Subtitle: 12px, weight 400, color #A1A1AA
│  (●)                            │  ← Small status dot: 8px circle, color #10B981 (green) = good
│                                 │
└─────────────────────────────────┘
```

**Card styling:**
- Background: `#18181b`
- Border: 1px solid `#27272a`
- Border-radius: 12px
- Padding: 20px internal
- No shadow

**The 4 cards in order:**

| Card | Label | Value | Subtitle | Dot color |
|------|-------|-------|----------|-----------|
| 1 | TOTAL PREDICTIONS | `97` | +12 since last cycle | green |
| 2 | ACCURACY | `68.2%` | 45/66 correct | green |
| 3 | BRIER MEAN | `0.1847` | Lower is better | green if <0.25, else red |
| 4 | PENDING | `31` | Awaiting resolution | gold |

### 5c. Middle Row — Chart + Market Details

Two cards side by side: left card (Brier Score chart) takes ~65% width, right card (Live Market Details) takes ~35% width.

#### LEFT: Brier Score Chart Card

**Card structure:**
```
┌──────────────────────────────────────────────┐
│  Performance                        Daily │ Weekly │ Monthly │
│                                              │
│  0.1847  −0.023 (−11.1%)                     │
│                                              │
│  (Chart area: line chart)                    │
│                                              │
│  Mon  Tue  Wed  Thu  Fri  Sat  Sun           │
└──────────────────────────────────────────────┘
```

**Detailed:**
- **Header row**: Left side has "Performance" in 16px, weight 600, white. Right side has 3 pill-shaped toggle buttons: "Daily", "Weekly", "Monthly" — each 28px tall, pill-shaped. The active one has gold background `#F59E0B` with black text. Inactive: background `#27272a` with text `#A1A1AA`.
- **Value row**: Below the header. The current Brier mean value in 28px bold white, followed by the change amount and percentage in 14px, green if improved (lower), red if worsened (higher). Prepend a directional arrow.
- **Chart area**: 
  - A line chart (not bar chart) with smooth curves
  - Line color: gold `#F59E0B`, 2px stroke
  - Fill below line: gold at 10% opacity (gradient from gold to transparent)
  - Grid lines: horizontal only, very faint `#27272a`
  - Y-axis labels (left side): numeric values like 0.10, 0.15, 0.20, 0.25, 0.30 — in 11px, color `#71717A`
  - X-axis labels (bottom): days of week — "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" — in 11px, color `#71717A`
  - Chart height: ~200px
  - No dots on data points — just a smooth line
  - A dotted horizontal reference line at 0.25 (random baseline) in `#52525B`

#### RIGHT: Live Market Details Card

**Card structure:**
```
┌──────────────────────────────┐
│  Live Market                 │
│                              │
│  BTC > $82,293               │
│  $82,420                     │
│                              │
│  ███████████████░░░░░░░       │
│                              │
│  ○ Strike Price     $82,293  │
│  ○ Current Price    $82,420  │
│  ○ Distance         +0.15%   │
│  ○ Model P(Up)      72.4%    │
│  ○ Yes Ask          $0.67    │
│  ○ Time Remaining   12:34    │
│                              │
│  [Explore Live Market →]     │
│                              │
└──────────────────────────────┘
```

**Detailed:**
- **Header**: "Live Market" in 16px, weight 600, white
- **Main headline**: "BTC > $82,293" — this is the current market contract. 18px, weight 500, color white. The ">" is the strike direction.
- **Large price**: The current BTC price in 36px, weight 700, color white (or green if above strike)
- **Progress bar**: A horizontal bar below the price. 8px tall, rounded-full. The fill represents time remaining in the current market window (100% = just opened, 0% = about to close). Fill color: gold `#F59E0B`. Track color: `#27272a`.
- **Stats list**: 6 rows, each with:
  - A small colored dot (8px circle) on the left — gold for most, green if positive, red if negative
  - Label in 13px, color `#A1A1AA`
  - Value on the right, 13px, weight 600, white
  - 12px vertical spacing between rows
- **CTA button**: At the bottom. Full width, 40px tall, rounded-full. Background `#27272a` (not gold — it's secondary). Text "Explore Live Market →" in 13px, weight 500, color `#A1A1AA`. On hover: background `#3F3F46`, text white.

### 5d. Bottom Row — Observation Snapshots + Resolution Feed

Same two-column layout as above: left card ~65%, right card ~35%.

#### LEFT: Observation Snapshots Card

**Card structure:**
```
┌──────────────────────────────────────────────────┐
│  Observation Snapshots                    Open │ Closed │ All │
│  Current model predictions and outcomes          │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  BTC 01:00   ↑ 72.4%  +3.1%  YES  0.16  │    │
│  ├──────────────────────────────────────────┤    │
│  │  BTC 01:15   ↓ 45.2%  +1.2%  NO   0.09  │    │
│  ├──────────────────────────────────────────┤    │
│  │  BTC 01:30   ↑ 68.1%  −0.8%  YES  0.11  │    │
│  ├──────────────────────────────────────────┤    │
│  │  BTC 01:45   ↓ 51.3%  +2.4%  NO   0.22  │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Detailed:**
- **Header**: Left: "Observation Snapshots" in 16px, weight 600, white. Below it: "Current model predictions and outcomes" in 13px, color `#A1A1AA`.
- **Filter tabs**: Right side of header. Three pill buttons: "Open", "Closed", "All" — same pill styling as the chart toggle (28px, pill-shaped). Active: gold bg, black text. Inactive: `#27272a` bg, `#A1A1AA` text.
- **Table rows**: Each row is a horizontal bar, ~48px tall, with:
  - **Left section**:
    - Market identifier: e.g., "BTC 01:00" — 14px, weight 500, white
    - A small directional arrow icon: ↑ (green `#10B981`) for UP prediction, ↓ (red `#F43F5E`) for DOWN prediction
  - **Center section**:
    - Model probability: "72.4%" — 14px, weight 600, white
    - Edge: "+3.1%" — 13px, green if positive, red if negative
  - **Right section**:
    - Predicted outcome pill: "YES" or "NO" — small rounded pill, 20px tall. YES = green bg `#10B981` at 15% opacity, text green. NO = red bg `#F43F5E` at 15% opacity, text red.
    - Brier score: "0.16" — 13px, color `#A1A1AA`
  - Row styling: border-bottom 1px `#27272a`, hover background `#1F1F23`
- **Empty state** (when no predictions): Center of the card, gray text "No snapshots yet — bot is warming up" with a subtle chart icon

#### RIGHT: Resolution Feed Card

**Card structure:**
```
┌──────────────────────────────┐
│  Resolution Feed        View All │
│                              │
│  ✓ BTC 00:45                │
│    Predicted: YES            │
│    Actual: NO                │
│    Brier: 0.38  ✗           │
│    2 min ago                 │
│  ─────────────────────────── │
│  ✓ BTC 01:00                │
│    Predicted: NO             │
│    Actual: NO                │
│    Brier: 0.04  ✓           │
│    17 min ago                │
│  ─────────────────────────── │
│  ...                         │
│                              │
└──────────────────────────────┘
```

**Detailed:**
- **Header**: Left: "Resolution Feed" in 16px, weight 600, white. Right: "View All" link in 13px, color gold `#F59E0B`, underlined on hover.
- **Resolution items**: Each item is a compact card-like block, ~80px tall, with:
  - **Top row**: A checkmark icon (✓) in green if correct, red if wrong. Next to it: market identifier "BTC 00:45" in 14px, weight 500, white.
  - **Details rows** (2 rows, stacked):
    - "Predicted: YES" / "Actual: NO" — 12px, color `#A1A1AA`
  - **Bottom row**: "Brier: 0.38" in 12px + a small "✗" (wrong) or "✓" (correct) icon. Time ago "2 min ago" in 12px, color `#71717A`, right-aligned.
  - Separator between items: 1px line `#27272a`
- **Max visible items**: 5 (scrollable if more)
- **Empty state**: "No resolutions yet" in center

---

## 6. Typography Scale Reference

| Element | Size | Weight | Color | Style |
|---------|------|--------|-------|-------|
| Logo text "BAYSED" | 14px | 700 | white | uppercase, letter-spacing 2px |
| Page title | 28px | 700 | white | — |
| Page subtitle | 14px | 400 | #A1A1AA | — |
| Card label (summary) | 11px | 600 | #71717A | uppercase, letter-spacing 1px |
| Card value (summary) | 32px | 700 | white | — |
| Card subtitle (summary) | 12px | 400 | #A1A1AA | — |
| Section title | 16px | 600 | white | — |
| Section subtitle | 13px | 400 | #A1A1AA | — |
| Nav item (sidebar) | 14px | 500 | #71717A (inactive) / white (active) | — |
| Stat label (market card) | 13px | 400 | #A1A1AA | — |
| Stat value (market card) | 13px | 600 | white | — |
| Table row primary | 14px | 500 | white | — |
| Table row secondary | 13px | 400 | #A1A1AA | — |
| Pill button text | 12px | 500 | #A1A1AA (inactive) / #000 (active) | — |
| Breadcrumb | 13px | 400 | #A1A1AA | current page white |
| Search placeholder | 13px | 400 | #71717A | — |

---

## 7. Interactive States Summary

| Element | Hover | Active/Selected | Focus |
|---------|-------|-----------------|-------|
| Nav item (sidebar) | bg at 5% opacity gold | bg at 10% opacity gold, icon + text gold/white | — |
| Summary card | border brightens to #3F3F46, slight translateY(-1px) | — | — |
| Pill button | bg slightly lighter | gold bg, black text | — |
| CTA button | bg #3F3F46, text white | — | — |
| Table row | bg #1F1F23 | — | — |
| Search input | border #F59E0B | border #F59E0B, bg #1F1F23 | border #F59E0B |
| Sidebar expand/collapse | text white | — | — |

---

## 8. Data Sources (API endpoints on baysed.onrender.com)

These are the existing FastAPI endpoints the terminal should fetch from:

| Data | Endpoint | Method |
|------|----------|--------|
| Bot status (cycles, started, errors) | `/status` | GET |
| Live market (strike, price, asks, model) | `/state` | GET |
| Pipeline health (discovery, resolution, feed) | `/pipeline-health` | GET |
| Recent predictions (list) | `/predictions?limit=50` | GET |
| Calibration data (Brier mean, accuracy, curve) | `/calibration` | GET |
| All predictions (for analytics) | `/predictions?limit=200` | GET |
| BTC WebSocket price stream | `wss://baysed.onrender.com/ws` | WS |
| Debug info | `/debug` | GET |

---

## 9. Page Routing

| Route | Page | Sidebar label |
|-------|------|---------------|
| `/` | Overview (this spec) | Overview |
| `/predictions` | All predictions table | Predictions |
| `/live-market` | Live market detail view | Live Market |
| `/calibration` | Calibration curves and analysis | Calibration |
| `/resolution` | Resolution history and analytics | Resolution |
| `/settings` | Bot configuration and status | Settings |

---

## 10. Responsive Behavior

- Below 1024px: sidebar auto-collapses to icon-only mode
- Below 768px: sidebar hides completely, hamburger menu appears in header
- Summary cards: 2-column grid on tablet, 1-column on mobile
- Middle and bottom rows: stack vertically on tablet/mobile

---

## 11. Animations

- Sidebar collapse/expand: 200ms ease-out (width + content fade)
- Card hover lift: 150ms ease
- Page transitions: 200ms fade-in (opacity 0→1)
- Number value updates: 300ms count-up animation (if feasible)
- No page loading spinners — use skeleton shimmer (gold-tinted) instead
