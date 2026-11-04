# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two competitive Super Smash Bros. Ultimate players: Zephyr (Cloud main, Steve secondary; Samsung A51, 412px wide, Brave) and his brother (Honor X7b, ~360px wide). They log every game they play and review their numbers to improve. They use it equally online at home (between online games, often at night, controller in hand) and at tournaments/locals (standing between sets, in a hurry, under bright venue light).

## Product Purpose

A personal KPI notebook for Smash Ultimate: log each game (characters, stage, result, stocks, bans, recovery/limit details) in seconds, then see what wins and loses games (matchups, stages, patterns, streaks, rivals) so practice can be targeted. Success: logging a game is fast and error-free, and the stats are understood at a glance.

## Positioning

Built around the competitive ruleset these two players actually play (Bo3/Bo5, stage bans, stock counts, start.gg tournament history and rival scouting), offline on their own phones, with no accounts and no server. Nobody else uses it.

## Operating Context

- Most frequent job: **Cargar game** right after a game ends, one-handed, in a few taps; this screen matters most.
- Other screens: Estadísticas, Historial (with VOD review queue), Notas (matchup notes), Ajustes (backups, start.gg sync, Google Drive backup, theme).
- Data comes from manual logging plus start.gg imports; backups via JSON/CSV and Google Drive.
- Used in both dim rooms and bright venues.

## Capabilities and Constraints

- Vanilla HTML/CSS/JS PWA on GitHub Pages; offline via service worker; IndexedDB; no backend, no paid services, no CDN (system fonts only).
- Spanish (rioplatense "vos") UI.
- Three user-selectable themes in Ajustes: Clásico (default), Smash, and a third theme (currently "Limpio", being replaced).
- Phones 320–412px wide are the target; desktop is incidental.

## Brand Commitments

- Name: Smash KPI. Personal, non-commercial use only; official Smash imagery (stage renders, emblem) is acceptable per the user.
- Each theme has its own app icon.

## Evidence on Hand

- Real stage thumbnails in img/stages/, character list in js/data.js, sample data generator in js/sample.js.
- No testimonials or external users; none should be invented.

## Product Principles

1. Logging speed beats everything: the next tap is always obvious and reachable with the thumb.
2. Every screen reads at a glance: titles, labels, controls and data must be unmistakably different from each other.
3. Never lose data; never surprise the user (no automatic reloads, no hidden state).
4. Numbers serve decisions: show what to practice, not just totals.

## Accessibility & Inclusion

High contrast is a requirement (user feedback: low contrast made screens hard to understand). Readable in bright venues and in the dark; large touch targets (≥44px).
