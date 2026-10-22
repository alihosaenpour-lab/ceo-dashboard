/* Spark Lab — public interactions */
(function () {
  'use strict';

  /* mobile nav */
  const navToggle = document.querySelector('.nav-toggle');
  const mobileNav = document.querySelector('.mobile-nav');
  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', function () {
      const open = mobileNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    });
  }

  /* scroll reveal */
  const io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08 }) : null;
  document.querySelectorAll('.reveal').forEach(function (el) {
    if (io) io.observe(el); else el.classList.add('visible');
  });

  /* flash auto-dismiss */
  document.querySelectorAll('.flash[data-autohide]').forEach(function (f) {
    setTimeout(function () {
      f.style.transition = 'opacity .4s, transform .4s';
      f.style.opacity = '0'; f.style.transform = 'translateY(10px)';
      setTimeout(function () { f.remove(); }, 450);
    }, 4200);
  });

  /* product gallery */
  const mainImg = document.getElementById('gallery-main-img');
  document.querySelectorAll('.gallery-thumbs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      mainImg.src = btn.dataset.src;
      document.querySelectorAll('.gallery-thumbs button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });

  /* product tabs */
  document.querySelectorAll('[data-tabs]').forEach(function (root) {
    root.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        root.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        root.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        const panel = root.querySelector('#' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
      });
    });
  });

  /* AJAX add-to-cart */
  document.querySelectorAll('form[data-ajax-cart]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      const orig = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '…'; }
      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch', 'X-CSRF-Token': window.SPARK_CSRF || '' },
        body: new URLSearchParams(new FormData(form)).toString(),
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.ok) {
          document.querySelectorAll('[data-cart-count]').forEach(function (el) { el.textContent = data.count; el.classList.remove('hidden'); });
          if (btn) { btn.innerHTML = '✓ اضافه شد'; setTimeout(function () { btn.innerHTML = orig; btn.disabled = false; }, 1400); }
        } else { if (btn) { btn.innerHTML = orig; btn.disabled = false; } }
      }).catch(function () { form.submit(); });
    });
  });

  /* confirm dialogs */
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      if (!window.confirm(form.dataset.confirm)) ev.preventDefault();
    });
  });

  /* qty buttons in cart */
  document.querySelectorAll('.qty-control').forEach(function (qc) {
    const input = qc.querySelector('input');
    qc.querySelectorAll('button[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        const step = parseInt(b.dataset.step, 10);
        const val = Math.max(0, Math.min(9, (parseInt(input.value, 10) || 0) + step));
        input.value = val;
        if (val === 0) { const rm = qc.closest('[data-cart-item]'); if (rm) rm.querySelector('form[data-remove]').submit(); }
        else { const up = qc.closest('[data-cart-item]'); if (up) up.querySelector('form[data-update]').submit(); }
      });
    });
  });
})();
