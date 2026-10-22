(() => {
  'use strict';

  // If signed in already, point the "Sign in" link at the workspace instead.
  try {
    if (localStorage.getItem('gather_token')) {
      const signIn = document.querySelector('.sign-in-link');
      if (signIn) {
        signIn.textContent = 'Open workspace';
        signIn.href = '/app';
        signIn.setAttribute('aria-label', 'Open your Gather workspace');
      }
    }
  } catch (_err) { /* public landing still works without storage */ }

  // Mobile navigation toggle.
  const menuButton = document.querySelector('#menu-toggle');
  const nav = document.querySelector('#site-nav');
  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    menuButton.setAttribute('aria-label', open ? 'Open navigation' : 'Close navigation');
    nav?.classList.toggle('open', !open);
  });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Open navigation');
  }));

  // Condense the header once the page scrolls.
  const header = document.querySelector('#site-header');
  const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Scroll-triggered reveals (respecting reduced-motion).
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll('.reveal');
  if (!prefersReduced && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.transitionDelay = (entry.target.dataset.delay || '0') + 'ms';
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });
    // Stagger items that share a grid.
    document.querySelectorAll('.bento .reveal, .steps-grid .reveal').forEach((el, i) => {
      el.dataset.delay = String((i % 3) * 90);
    });
    targets.forEach(el => observer.observe(el));
  } else {
    targets.forEach(el => el.classList.add('in'));
  }
})();
