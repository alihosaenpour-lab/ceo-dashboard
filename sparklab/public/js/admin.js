/* Spark Lab — admin interactions */
(function () {
  'use strict';

  const side = document.querySelector('.admin-side');
  const toggle = document.querySelector('.admin-side-toggle');
  if (toggle && side) {
    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      side.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (side.classList.contains('open') && !side.contains(e.target) && !toggle.contains(e.target)) {
        side.classList.remove('open');
      }
    });
  }

  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.dataset.confirm)) ev.preventDefault();
    });
  });

  /* repeatable FAQ rows in product form */
  const faqList = document.getElementById('faq-list');
  const faqAdd = document.getElementById('faq-add');
  if (faqList && faqAdd) {
    faqAdd.addEventListener('click', function () {
      const div = document.createElement('div');
      div.className = 'faq-row';
      div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:.6rem;margin-bottom:.6rem;align-items:start;';
      div.innerHTML =
        '<input class="input" name="faq_q" placeholder="پرسش">' +
        '<textarea class="textarea" name="faq_a" placeholder="پاسخ" style="min-height:44px"></textarea>' +
        '<button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>';
      faqList.appendChild(div);
    });
  }

  /* gateway mode hint */
  const gwSelect = document.getElementById('gateway-active');
  const zpBlock = document.getElementById('zarinpal-block');
  const testBlock = document.getElementById('test-gateway-block');
  function syncGw() {
    if (!gwSelect) return;
    if (zpBlock) zpBlock.classList.toggle('hidden', gwSelect.value !== 'zarinpal');
    if (testBlock) testBlock.classList.toggle('hidden', gwSelect.value !== 'test');
  }
  if (gwSelect) { gwSelect.addEventListener('change', syncGw); syncGw(); }
})();
