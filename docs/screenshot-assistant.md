# Screenshot assistant

`screenshot-assistant.js` accepts only one explicitly captured screenshot or
explicitly selected image file, then submits it to the ready media vision worker.
The visible text and scene description must exactly match that worker's evidence.

Error, chart, or scene explanations cite a bounded evidence span. Translate,
rewrite, and explain operations apply only to explicit visible-text spans and are
returned as review-only proposals. The result exposes capture-through-result
measurements and no UI activation, input injection, file-writing, or executor API.
