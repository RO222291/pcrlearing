# Learning Grove

Live website: https://ro222291.github.io/pcrlearing/

An independent English-first learning website: eight paths, 48 original introductory mini-lessons, practice feedback, review list, eight completion stamps, a daily streak, and a local learning passport.

Chinese learning material includes pinyin and English meanings. Navigation and all guidance are in English. This is a new starter curriculum; it does not claim to include the earlier external sites' complete content, cloud accounts, multiplayer systems, or saved progress.

## Style

ROKOHCHA (#74673E), verified from https://nipponcolors.com/#rokohcha, with warm-white, sage and dark-earth supporting colors. System sans-serif fonts; responsive layouts; visible keyboard focus; reduced-motion support.

## Source and build

Unzip `website-source.zip`. `index.html` is the page shell, `style.css` provides the theme, `data.js` contains all lessons, and `app.js` handles navigation, practice and passport storage. Run `python3 -m http.server 8000` in the extracted directory to preview. Run `python3 build.py` to create a standalone publication in the sibling `pcrlearing-publish` directory.

## Publish

Upload `index.html`, `.nojekyll`, `README.md` and `website-source.zip` to the repository root. GitHub Pages uses `main` and `/ (root)` with HTTPS. No workflow or build service is needed.

## Progress

Uses `learning-grove.v1` in localStorage. Correct answers complete lessons once; repeat practice can extend the local-calendar daily streak. Incorrect answers and manually saved lessons appear in My review. Correct answers clear that lesson from review. Passport backup/restore works across browsers, merging saved progress. No account, analytics, external fonts, video embeds or server calls are used by the learning app.

Previous Wanyao directory versions remain available in Git history.

## Validation

All 48 lesson routes were checked for three answer choices, question text and mobile overflow. Incorrect-answer retry, lesson completion, a six-lesson path stamp, persisted progress after reload, and backup merging were verified in the browser. The September 11 publication retries a GitHub Pages deployment timeout; the learning content is unchanged.
