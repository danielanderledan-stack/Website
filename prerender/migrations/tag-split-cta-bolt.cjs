/* ============================================================================
   Migration: tag-split-cta-bolt
   Makes the split-CTA lightning bolt editable by STRING-SPLICING a data-ce onto
   its <svg> open tag — no jsdom, no re-serialisation. The generic jsdom tagger
   (tag-icons) works on freshly-fused pages, but re-serialising an already-LIVE
   page reflows any editor-SWAPPED icon (a single-line <svg><path/></svg> baked by
   save-icon) onto several lines, which trips tag-icons' byte-strict gate. This
   migration sidesteps that entirely: it only appends three attributes to the one
   bolt <svg>, preserving every other byte (including swapped icons) exactly.

   The bolt is uniquely identified by its 72x72 viewBox="0 0 80 80" open tag (the
   service-card icons are 40x40; swapped icons carry their own viewBox). The id
   s1-icon-1 matches what the jsdom tagger stamps on sites that round-trip cleanly,
   so all sites end up identical. index.html only (the bolt lives on the home page).

   ATTRS-ONLY + idempotent: stripping the inserted attrs from the output yields the
   original byte-for-byte; re-running is a no-op.
   ============================================================================ */
"use strict";

const ATTRS = ' data-ce="s1-icon-1" data-ce-cap="icon" data-ce-label="Icon"';

// the split-CTA bolt: an <svg> open tag that is 72x72 with viewBox="0 0 80 80"
// and not already tagged. Lookaheads keep it attribute-order-agnostic.
const BOLT_OPEN =
  /<svg(?=[^>]*\bwidth="72")(?=[^>]*\bviewBox="0 0 80 80")(?![^>]*\bdata-ce=)[^>]*>/;

function isApplied(html) {
  return html.indexOf('data-ce="s1-icon-1"') !== -1;
}

// Returns { changed, html, reason? }. changed=false when already tagged or no
// untagged bolt is present (both are safe no-ops).
function applyHtml(html) {
  if (isApplied(html)) return { changed: false, html };
  const m = BOLT_OPEN.exec(html);
  if (!m) return { changed: false, html, reason: "no untagged split-CTA bolt" };
  const tag = m[0];
  const newTag = tag.slice(0, -1) + ATTRS + ">";
  return {
    changed: true,
    html: html.slice(0, m.index) + newTag + html.slice(m.index + tag.length),
  };
}

module.exports = {
  id: "tag-split-cta-bolt",
  label: "Editable split-CTA lightning bolt (string splice)",
  attrs: ATTRS,
  boltOpen: BOLT_OPEN,
  isApplied,
  applyHtml,
  // the bolt only appears on the home page
  targets: ["index.html"],
};
