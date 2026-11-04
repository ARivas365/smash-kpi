---
name: Smash KPI
description: Personal Smash Ultimate KPI notebook; offline phone PWA with three themes (Clásico, Smash, Planilla).
colors:
  planilla-ink: "#111214"
  planilla-ink-secondary: "#4a4f57"
  planilla-paper: "#ffffff"
  planilla-wall: "#e4e6e9"
  planilla-sheet-tint: "#eef0f2"
  planilla-rule: "#c4c8ce"
  planilla-input-stroke: "#8a9099"
  planilla-highlighter: "#ffe14d"
  planilla-highlighter-soft: "#fff3b0"
  planilla-win: "#0b7a42"
  planilla-loss: "#c62828"
  planilla-warn: "#a15c00"
  planilla-limit: "#6a2fc8"
  clasico-night: "#0f1117"
  clasico-surface: "#181b24"
  clasico-text: "#e9ebf1"
  clasico-muted: "#9aa1b3"
  clasico-accent: "#4da3ff"
  clasico-win: "#3ccf8e"
  clasico-loss: "#ff6363"
  smash-ember: "#140f0e"
  smash-surface: "#1f1816"
  smash-cream: "#fbf3ee"
  smash-gold: "#ffc93c"
  smash-red: "#e8382f"
typography:
  app-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 900
    letterSpacing: "-0.01em"
  block-heading:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "1.22rem"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  block-heading-planilla:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 900
    lineHeight: 1.2
  block-heading-smash:
    fontFamily: "Roboto, Segoe UI, system-ui, sans-serif"
    fontSize: "1.12rem"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "0.01em"
  field-label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "1.02rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  aside:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 600
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
  stat-value:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "1.7rem"
    fontWeight: 800
    fontFeature: "tnum"
  stat-label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
  tab-label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
rounded:
  planilla-tag: "4px"
  planilla-paper: "6px"
  planilla-bar: "8px"
  clasico-control: "12px"
  clasico-card: "14px"
  smash-chip: "10px"
  smash-card: "18px"
spacing:
  chip-gap: "8px"
  card-gap: "10px"
  view-gap: "12px"
  card-padding: "14px"
  bracket-gap: "14px"
  touch-min: "48px"
components:
  planilla-block-tab:
    backgroundColor: "{colors.planilla-ink}"
    textColor: "{colors.planilla-paper}"
    typography: "{typography.block-heading-planilla}"
    rounded: "{rounded.planilla-tag}"
    padding: "3px 11px 5px"
  planilla-block-tab-limit:
    backgroundColor: "{colors.planilla-limit}"
    textColor: "{colors.planilla-paper}"
  planilla-card:
    backgroundColor: "{colors.planilla-paper}"
    rounded: "{rounded.planilla-paper}"
    padding: "14px"
  planilla-chip:
    backgroundColor: "{colors.planilla-paper}"
    textColor: "{colors.planilla-ink}"
    rounded: "{rounded.planilla-paper}"
    padding: "0 16px"
    height: "48px"
  planilla-chip-selected:
    backgroundColor: "{colors.planilla-highlighter}"
    textColor: "{colors.planilla-ink}"
  planilla-button:
    backgroundColor: "{colors.planilla-paper}"
    textColor: "{colors.planilla-ink}"
    rounded: "{rounded.planilla-paper}"
    padding: "10px 16px"
    height: "48px"
  planilla-button-primary:
    backgroundColor: "{colors.planilla-ink}"
    textColor: "{colors.planilla-paper}"
    rounded: "{rounded.planilla-paper}"
    padding: "10px 16px"
    height: "54px"
  planilla-button-danger:
    backgroundColor: "{colors.planilla-paper}"
    textColor: "{colors.planilla-loss}"
  planilla-input:
    backgroundColor: "{colors.planilla-paper}"
    textColor: "{colors.planilla-ink}"
    rounded: "{rounded.planilla-paper}"
    padding: "10px 12px"
    height: "48px"
  planilla-segment-selected:
    backgroundColor: "{colors.planilla-ink}"
    textColor: "{colors.planilla-paper}"
  planilla-result-win:
    backgroundColor: "{colors.planilla-win}"
    textColor: "{colors.planilla-paper}"
  planilla-savebar:
    backgroundColor: "{colors.planilla-wall}"
    rounded: "{rounded.planilla-bar}"
    padding: "8px"
  planilla-tabbar:
    backgroundColor: "{colors.planilla-paper}"
    textColor: "{colors.planilla-ink-secondary}"
    typography: "{typography.tab-label}"
    height: "64px"
  planilla-topbar:
    backgroundColor: "{colors.planilla-ink}"
    textColor: "{colors.planilla-paper}"
    typography: "{typography.app-title}"
  clasico-button-primary:
    backgroundColor: "{colors.clasico-accent}"
    textColor: "{colors.clasico-night}"
    rounded: "{rounded.clasico-control}"
    height: "48px"
  smash-button-primary:
    backgroundColor: "{colors.smash-gold}"
    textColor: "{colors.smash-ember}"
    height: "48px"
---

# Design System: Smash KPI

## Overview

**Creative North Star: "The Bracket Sheet on the Venue Wall"**

Smash KPI is a phone-only logging notebook used one-handed between games, in dim rooms and under bright venue light. It ships three user-selectable themes that share one structure and one typographic hierarchy: **Clásico** (the default, a dark night-blue screen with a blue accent), **Smash** (ember black with red and gold, heavy italic display moments), and **Planilla** (the newest world, which replaced the removed "Limpio" theme). Themes swap tokens and a scoped override block. Layout, components and copy stay the same.

Planilla is the app as the paper bracket sheet taped to the local's wall: black marker on white paper over a grey wall, with highlighter on whatever is chosen. Every card is a white sheet opened by a reversed black tab title. Every control is a box drawn in 2px ink. The selected option is highlighted, the primary action is a solid ink bar, and green and red appear only for results. The world is flat colour at maximum contrast. Depth comes from ink lines and fills, never from blur, glow or gradient. It is the high-contrast answer to the user's complaints that screens were low-contrast, hard to parse, and had a floating tab bar.

Across all themes the hierarchy has to read at a glance: block name > field question > aside. Options sit inside their own control, so they never compete with titles.

**Key Characteristics:**
- Three themes, one structure; Clásico is the default; Planilla is the light, maximum-contrast world.
- Planilla: ink on paper on a grey wall, highlighter = selection, ink fill = primary action, green/red = result only.
- Shared three-step heading ladder (block 900 > label 800 > aside 600 muted).
- Drawn 24-grid stroke icons, never emoji.
- System fonts only, offline, 320–412px phones, 48px minimum touch targets, Spanish (rioplatense) UI.

## Colors

Each theme is a full token set on the root element. Planilla uses three values (ink, paper, wall) plus one highlighter, with semantic colours kept apart.

### Primary
- **Marker Ink** (planilla-ink): text, 2px control outlines, reversed block tabs, the top band, the primary action fill, the selected segment, chart lines and bar fills. It also serves as the Planilla accent, so carets, focus outlines and links are ink.
- **Highlighter Yellow** (planilla-highlighter): selection only. Selected chips, the selected stage caption and ring, the active tab underline, focus halo, text selection, and badges.
- **Soft Highlighter** (planilla-highlighter-soft): a "this line is live" wash for the in-progress set bar, the update bar, the selected theme option, low-data chips and VOD badges.

### Secondary
- **Result Green** (planilla-win): won results only. It sets the outline of the chosen Gané/stock box, the filled score box of a won set, pick-suggestion borders and good stage records.
- **Result Red** (planilla-loss): lost results and destructive actions only (Borrar outline and text, ban suggestions, losing pattern bars).

### Tertiary
- **Burnt Amber** (planilla-warn): alert-card 2px border.
- **Limit Violet** (planilla-limit): Cloud's Limit card. It colours the card border and replaces ink on that card's block tab.

### Neutral
- **Venue Wall Grey** (planilla-wall): page ground and the opaque save bar.
- **Paper White** (planilla-paper): cards, chips, buttons, inputs, stages and the tab bar.
- **Sheet Tint** (planilla-sheet-tint): secondary surfaces such as head-to-head boxes, suggestion boxes and code.
- **Pencil Rule** (planilla-rule): 1px card borders, ghost buttons, stat-sheet cell rules and history row rules.
- **Secondary Ink** (planilla-ink-secondary): asides, stat labels and inactive tabs.
- **Input Stroke** (planilla-input-stroke): resting 2px input border. It goes to ink on focus.

### Clásico and Smash (summary)
- **Clásico**: Night ground (clasico-night), surfaces clasico-surface / #222634, border #2e3344, text clasico-text, muted clasico-muted, accent Clásico Blue (clasico-accent) with dark accent ink #06121f, win clasico-win, loss clasico-loss, warn #f5b84a, limit #b590ff. The selected chip fills with the accent. It also uses a translucent blurred top bar and save bar.
- **Smash**: Ember ground (smash-ember), surfaces smash-surface / #2a211e, border #3a2e2a, text Cream (smash-cream), muted #b3a39b. Smash Gold (smash-gold) is reserved for the action (Guardar) and the selected stage ring. Selected chips are cream on ember, not gold. Smash Red (smash-red) is the slanted top-bar stripe and the set bar outline. Win #3dd68c, loss #ff6b6b, warn #ff9f43, limit #c4a1ff.

### Named Rules
**The Highlighter Means Chosen Rule.** In Planilla the yellow marks exactly what is selected, focused or live, and nothing else. It is never decoration, never a heading colour and never a button fill.

**The Results-Only Colour Rule.** Green and red are spent on Gané/Perdí, scores, pick/ban suggestions and destructive actions. A neutral control is never tinted with them.

**The One Ink Action Rule.** The solid ink fill belongs to the primary action (Guardar) and the selected segment. Every other button is a paper box with an ink outline.

## Typography

**Display Font:** system UI stack (system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif)
**Body Font:** the same system stack
**Smash display:** Roboto, Segoe UI, system-ui (still a system face; set italic 900 uppercase)

**Character:** One system sans family carries everything. Hierarchy comes from weight steps (900 / 800 / 600) and, in Planilla, reversal. Size stays nearly flat. Nothing is downloaded.

### Hierarchy
- **App title** (900, 1.3rem in Planilla / 700 1.15rem in Clásico / italic 900 1.5rem uppercase in Smash): the top band's screen title.
- **Block heading** (900, 1.22rem, line-height 1.2, -0.01em): names each card (Partida, Personajes, Stage, Resultado, Recovery, Notas). It is an `h2` heading or the summary label of a collapsible card. Smash sets it italic 900 uppercase at 1.12rem. Planilla sets it as a reversed black tab at 1.08rem 900 (see Components).
- **Field label** (800, 1.02rem, line-height 1.25): the questions inside a card (Rival, Mi personaje…), one step below the block. A field label after the first gets 8px more space above it than below.
- **Aside** (600, 0.86rem, muted): clarifications under a label. It is always smaller and greyer than the label it explains.
- **Body** (400, 16px, line-height 1.4).
- **Stat value** (800, 1.7rem, tabular numerals; 900 in Smash italic and in Planilla) with **stat label** (600 0.78rem muted; 700 in Planilla).
- **Tab label** (600, 0.72rem; 900 ink when active in Planilla).

### Named Rules
**The Three-Step Ladder Rule.** Block heading > field label > aside, separated by weight (900 > 800 > 600) and colour (text > text > muted). An option's text lives inside its own control and must never look like a heading.

**The System Face Rule.** No webfonts, no CDN. Every theme resolves to faces already on the phone.

## Layout

The layout is a single column for phones 320–412px wide, capped at 640px and centred (desktop is incidental). The view has 12px side padding and 12px between cards. Cards have 14px padding and a 10px internal gap, and chips have an 8px gap. Every tappable control is at least 48px tall (44px for small buttons). The result stock boxes are 112px tall for thumb hits. The stage picker is a 3-column grid. Below 360px the filter segments wrap to two rows and the result stocks drop below Gané/Perdí, so words are never truncated.

The bottom of the screen is a fixed stack. The tab bar (64px plus safe area) is pinned flush to the bottom edge. The save bar (Guardar) is sticky 8px above it and spans the full content width.

Planilla stats are a ruled sheet. Stat tiles form one 2-column grid with 0 gap inside a single 2px ink frame, and the cells are separated by 1px pencil rules. Games inside a history set are rows separated by 1px rules, not nested boxes.

## Elevation & Depth

Planilla is flat. Depth is ink: 2px outlines, the reversed tab, solid fills, and a 3px highlighter ring on the selected stage. The only shadow in the world is the transient toast (`0 6px 20px rgba(17,18,20,.3)`), which floats over content for a few seconds. Clásico and Smash also stay mostly flat, but they use translucent top and save bars with `backdrop-filter: blur(6px)`. Clásico's toast uses `0 6px 24px rgba(0,0,0,.4)`.

### Named Rules
**The Flat Paper Rule.** Planilla has no decorative gradients, no blur and no glow. Bars are opaque (the top band is ink, the save bar is wall grey, the tab bar is paper) and every fill is a flat colour. The select chevron is drawn with two hard-stop gradients and is a glyph, not a surface. It is the one permitted gradient use.

## Shapes

Planilla uses square paper corners: 6px on cards, controls, inputs, stages and segments. Tags, score boxes and the block tab are 4px. The save bar is 8px, and bottom sheets are 8px on top and 0 when full-screen. Strokes are 2px ink on every interactive box, 1px pencil rule on sheets and cells, and dashed for ghost chips. Clásico is rounder (12px controls, 14px cards, 20px sheets). Smash is roundest on cards (18px) with 10px chips, and its primary button and top stripe are slanted parallelograms (`clip-path` with 9px insets).

## Components

### Block Tab (Planilla signature)
Each card opens with its name reversed out of ink, like a label on a sheet. The tab is an ink fill with white 900 text at 1.08rem, padded 3px 11px 5px, with 4px corners. It sizes to its content at the start of the row and does not wrap. On the Limit card the tab is Limit Violet. In Clásico the same heading is plain 900 text, and in Smash it is italic uppercase.

### Bracket Connector (Planilla signature)
The G1 / G2 / G3 game-number chips are joined by 14px × 2px ink lines with a 14px gap between boxes, so they read as linked match boxes on a bracket. The line is applied only to the game-number row.

### Chips
- **Style:** paper box, 2px ink outline, 6px corners, 48px tall, 0 16px padding, weight 600.
- **Selected:** highlighter fill, ink outline, weight 800.
- **Ghost:** dashed secondary-ink outline on transparent. **Dim / banned:** 55% opacity (banned also struck through).

### Buttons
- **Shape:** 6px corners, at least 48px tall (54px and 64px for the big and extra-large sizes).
- **Primary (Guardar):** solid ink with white 900 text.
- **Default:** paper with a 2px ink outline, weight 700. **Ghost:** transparent with a pencil-rule outline.
- **Danger (Borrar):** paper with a red outline and red text. It is never filled and never louder than the action beside it.
- **Press:** scale to 0.98.

### Result Boxes
Gané/Perdí and the stock count are paper boxes with a 2px ink outline. When chosen they keep a paper fill and switch the outline to win green or loss red. Clásico and Smash fill the chosen box instead. In history the set score is a 54px box: filled green with white text when won, and paper with a red outline and red text when lost.

### Segmented Filters
The segments are joined boxes inside one 2px ink frame, divided by 2px ink rules. The selected segment is ink with white text. Count badges are highlighter.

### Inputs / Fields
- **Style:** paper with a 2px Input Stroke border, 6px corners, 48px tall.
- **Focus:** the border goes to ink, with a 3px highlighter ring and no outline.
- **Placeholder:** muted at full opacity in all themes. The caret uses the theme accent.

### Stages
Each stage is a paper frame with a 2px ink outline and 6px corners, showing the image with its name below. When selected it gets a 3px highlighter ring, the caption on highlighter, and an ink check badge. Pick suggestions use a 3px green outline and ban suggestions a red one.

### Save Bar
The save bar is opaque wall grey with 8px corners, sticky 8px above the tab bar. Its wall-grey extension below hides content scrolling between it and the tab bar. Planilla turns its blur off.

### Navigation
- **Top band:** solid ink, with a white 900 1.3rem title and a logo ringed in 2px white.
- **Tab bar:** five tabs pinned flush to the bottom edge with a 2px ink top rule on paper. Inactive tabs are secondary ink at 600. The active tab is ink 900 with a 5px highlighter underline (inset). Icons are 24px drawn strokes.
- **Bottom sheets:** 2px ink top edge and an ink rule under the sheet head.

### Focus and Selection
Planilla focus on chips, buttons, segments, stages, result boxes, tabs, links, summaries, picks and theme options is a 2px ink outline at 2px offset plus a 5px highlighter halo. Text selection is highlighter with ink text. In the other themes selection is the accent with accent ink.

### Icons
Icons are drawn inline SVG on a 24×24 grid (stroke 2, round caps and joins, no fill). They size at 1.1em inline and 24px in the tab bar. The set covers calendar, trophy, VOD, clock, cloud, book, pencil, chevrons, ban, check, arrow, star, globe, venue, key, search, expand and note. New icons are added to the same set in the same stroke style.

## Do's and Don'ts

### Do:
- **Do** open every Planilla card with the reversed ink block tab, and keep field labels at 800 and asides at 600 muted beneath it.
- **Do** draw every Planilla control as a paper box with a 2px ink outline and 6px corners, at least 48px tall.
- **Do** mark the chosen option, the focused control and the active tab with highlighter, and only those.
- **Do** keep the primary action a full-width solid ink bar sitting on the opaque save bar above the pinned tab bar.
- **Do** present Planilla stats as one ink-framed ruled sheet with tabular numerals in fixed columns.
- **Do** use the drawn stroke icon set for every pictogram, and system fonts only.
- **Do** add new theme styling as tokens on the theme root plus scoped overrides, so the three themes keep one structure.

### Don't:
- **Don't** use emoji as icons; they change from phone to phone.
- **Don't** add gradients, blur or glow to Planilla surfaces, and don't make its bars translucent.
- **Don't** use green or red for anything but results, suggestions and destructive actions.
- **Don't** fill a destructive button or make it louder than its neighbour action.
- **Don't** float the tab bar off the bottom edge.
- **Don't** mark state with a coloured side stripe on cards or rows in Smash or Planilla. Mark the result in the score box or with a soft fill.
- **Don't** load webfonts or any CDN asset.
