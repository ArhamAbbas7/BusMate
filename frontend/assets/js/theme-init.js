// Runs before first paint (classic script in <head>) so the saved theme applies without a flash.
// 'light' | 'dark' | missing = follow the operating system.
(function () {
  try {
    var t = localStorage.getItem('evbus.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked */ }
})();
