---
title: Missing favicon PNGs and Apple touch icon
date: 2026-04-06
status: resolved
tags: [web-ui]
modules: [web]
---

# Missing favicons

The visual transition added `icon.webp` as the app icon but the standard favicon sizes were never generated:

- `favicon-32.png` (standard browser tab)
- `favicon-16.png` (bookmark bar, small contexts)
- `apple-touch-icon.png` (180x180, iOS home screen bookmark)

The former source icon is preserved at `.lore/archive/art/icon.webp` (512x512).
It is historical and must not constrain a replacement icon or favicon work.
