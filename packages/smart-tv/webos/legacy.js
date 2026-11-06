// Chromium 87 (webOS 22) lacks `aspect-ratio`: gives each element with an
// `aspect-*` class the height its width calls for, as it changes.
(function () {
  if (!window.CSS || CSS.supports('aspect-ratio', '1')) return;
  if (!window.ResizeObserver || !window.MutationObserver) return;

  var NAMED = { 'aspect-video': 16 / 9, 'aspect-square': 1 };
  var ARBITRARY = /^aspect-\[(\d*\.?\d+)\/(\d*\.?\d+)\]$/;
  // An element sized on its own, which aspect-ratio would leave alone.
  var SIZED = /^(h|size)-(?!auto$)/;
  var SET = 'data-aspect-height';

  function ratio(el) {
    var list = el.classList;
    if (!list) return 0;
    for (var i = 0; i < list.length; i++) {
      var name = list[i];
      if (NAMED[name]) return NAMED[name];
      var m = ARBITRARY.exec(name);
      if (m && +m[2] > 0) return +m[1] / +m[2];
    }
    return 0;
  }

  function sized(el) {
    for (var i = 0; i < el.classList.length; i++)
      if (SIZED.test(el.classList[i])) return true;
    return false;
  }

  function fit(el) {
    var r = ratio(el);
    if (!r || sized(el)) {
      if (el.hasAttribute(SET)) {
        el.style.height = '';
        el.removeAttribute(SET);
        observer.unobserve(el);
      }
      return;
    }
    var width = el.getBoundingClientRect().width;
    if (!width) return;
    var height = Math.round((width / r) * 100) / 100 + 'px';
    if (el.style.height !== height) el.style.height = height;
    el.setAttribute(SET, '');
  }

  var observer = new ResizeObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) fit(entries[i].target);
  });

  function watch(el) {
    if (!ratio(el) || el.__aspect) return;
    el.__aspect = true;
    observer.observe(el);
    fit(el);
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    watch(node);
    var found = node.querySelectorAll('[class*="aspect-"]');
    for (var i = 0; i < found.length; i++) watch(found[i]);
  }

  function drop(node) {
    if (node.nodeType !== 1) return;
    var all = [node].concat(
      Array.prototype.slice.call(node.querySelectorAll('[class*="aspect-"]'))
    );
    for (var i = 0; i < all.length; i++)
      if (all[i].__aspect && !all[i].isConnected) {
        all[i].__aspect = false;
        observer.unobserve(all[i]);
      }
  }

  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.type === 'attributes') {
        var el = record.target;
        if (el.__aspect) fit(el);
        else watch(el);
        continue;
      }
      for (var j = 0; j < record.addedNodes.length; j++)
        scan(record.addedNodes[j]);
      for (var k = 0; k < record.removedNodes.length; k++)
        drop(record.removedNodes[k]);
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  if (document.body) scan(document.body);
})();
