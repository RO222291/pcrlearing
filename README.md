# 萬妖文書版｜中英對照 / Wanyao Learning Archive

https://ro222291.github.io/pcrlearing/

Restores the copied Chinese learning directory, original eight station descriptions, station links, screenshots, QR codes, videos and passport link. English translations are shown on separate lines immediately beneath the Chinese. The palette uses ROKOHCHA #74673E from https://nipponcolors.com/#rokohcha with warm-paper supporting colors.

The earlier independent Learning Grove curriculum is not used on this homepage. Previous versions remain in Git history.

## Scope

This repository contains the directory. The linked passport and eight learning websites are separate external sites. Their Chinese lessons and interfaces have not been translated or recolored by this repository. Screenshots and videos retain their original source language; their labels and the directory's explanatory text are bilingual.

## Editable source

Extract website-source.zip. Edit index.html, css/style.css, data/sites.js and js/*.js. The source is static and can be previewed using python3 -m http.server 8000. Chinese text and English translations are paired with ` / ` in source data; js/bilingual.js displays each pair as separate language-tagged lines.

## Deployment

GitHub Pages publishes main from / (root). The uploaded index.html embeds all scripts, CSS and images. .nojekyll disables Jekyll. Original analytics counters are removed. Original Chinese content and media retain their original authorship.
