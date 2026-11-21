/* ------------------------------------------------------------------
   lorry-responsive.js
   Adds column labels to table cells and marks wide tables (5+ columns)
   so lorry-responsive.css can show them as cards on phones.
   Add before </body> (any page; it only looks at tables):
     <script src="js/lorry-responsive.js"></script>
------------------------------------------------------------------- */
(function () {
  function enhance(table) {
    const heads = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    table.setAttribute('data-rl', '1');
    if (!heads.length) return;
    if (heads.length >= 5) table.classList.add('rl-cards');
    table.querySelectorAll('tbody tr').forEach(tr => {
      Array.from(tr.children).forEach((td, i) => td.setAttribute('data-label', heads[i] || ''));
    });
  }
  function run() { document.querySelectorAll('table:not([data-rl])').forEach(enhance); }

  // Tables are re-drawn by the page's scripts, so watch for new ones
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; run(); });
  }).observe(document.body, { childList: true, subtree: true });
  run();
})();
