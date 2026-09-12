# 萬妖文書版與步學吾數｜中英對照

- 學習入口 / Directory: https://ro222291.github.io/pcrlearing/
- 數學站 / Mathematics: https://ro222291.github.io/pcrlearing/math.html
- 教師頁 / Teacher results: https://ro222291.github.io/pcrlearing/math-teacher.html

保留原中文網站，逐項加入英文對照。數學站保留下載時的 134 個技能單元、3,219 題、選項、正確答案、解說與本機進度功能。使用 ROKOHCHA #74673E 與暖紙色系，加入英文技能標籤、圖表文字對照與英文朗讀。

The copied Chinese directory is preserved. The math site retains all 134 skill nodes and 3,219 original questions, options, answer keys and explanations. English appears alongside Chinese. Diagram labels have bilingual keys; explanations offer English speech using the browser's available voices. Progress remains stored locally in the browser.

## Scope and service dependencies

Only the directory and copied math site are included in this deployment. The passport and seven other learning stations remain external. Their contents and videos are not translated here. Original illustrations remain intact; instructional SVG diagram labels receive bilingual keys.

Class leaderboards, multiplayer/market services and cloud sign-in still depend on the original operators' external servers. No replacement backend is deployed on GitHub Pages. The original weekly-board endpoint returned HTML rather than usable results during validation, so cloud class results could not be verified. The translated error messages and original offline sharing fallback are retained. External sign-in pages remain operated by their original providers.

## Editable source

`website-source.zip` contains the directory source. `math-assets-source.zip` contains the original image assets. `math-source.zip` contains the downloaded original math source, translation dictionaries, build scripts and validation checks. Original material retains its original authorship.

To rebuild math, extract both math-source.zip and math-assets-source.zip into the same folder, run `npm ci --prefix math-build`, `python3 math-build/merge.py`, then `node math-build/build.cjs`. Output is written to pcrlearing-publish. Run `node math-build/test.cjs` to verify original data preservation, translation coverage, dynamic bilingual rendering, click handling and embedded question-bank loading. Preview with `python3 -m http.server 8000 --directory pcrlearing-publish`.

## Deployment

GitHub Pages publishes main from / (root); `.nojekyll` disables Jekyll. The math assets are packed into four JavaScript files to preserve relative paths without requiring a backend. Local scripts and styles have content-version URLs. Original analytics counters are omitted. Earlier deployments remain in Git history.

## Validation

All 135 original data files (134 banks plus skill tree) match the bundled data. All 3,219 question records and answer keys are unchanged. Every Chinese-containing question/data string resolves to an English translation. Numeric translation differences were reviewed, including discounts, large-number names and deliberately incorrect distractors. Basic practice, feedback, explanation, resume, dashboard and mobile navigation were checked in the browser. This is not a claim that every external cloud operation or every possible gameplay sequence has been tested.
