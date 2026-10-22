(() => {
  const state = {
    token: localStorage.getItem('gather_token'),
    user: readUser(),
    authMode: 'login',
    view: 'home',
    browseMode: 'venues',
    events: [],
    selectedListing: null
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const authModal = $('#auth-modal');
  const eventModal = $('#event-modal');
  const browseModal = $('#browse-modal');
  const browseBack = document.createElement('button');
  browseBack.type = 'button';
  browseBack.className = 'browse-back button button-outline';
  browseBack.setAttribute('aria-label', 'Close search and return to Gather');
  browseBack.textContent = '← Back to Gather';
  browseBack.addEventListener('click', () => browseModal.close());
  browseModal.prepend(browseBack);
  const bookingModal = $('#booking-modal');
  const toast = $('#toast');
  let toastTimer;

  function readUser() {
    try { return JSON.parse(localStorage.getItem('gather_user') || 'null'); }
    catch { return null; }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  async function api(url, options = {}) {
    const headers = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...options.headers
    };
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function dateLabel(value) {
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return { month: 'TBD', day: '--', full: 'Date to be announced' };
    return {
      month: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date),
      day: date.getDate(),
      full: new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
    };
  }

  function formatAmount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--';
  }

  // Loading skeletons keep the workspace feeling responsive while data loads.
  function skeletonList(count = 3) {
    const card = '<div class="skeleton-card" aria-hidden="true"><div class="sk sk-date"></div><div><div class="sk sk-l1"></div><div class="sk sk-l2"></div></div><div class="sk sk-pill"></div></div>';
    return `<div class="loading" role="status"><span class="visually-hidden">Loading…</span>${card.repeat(count)}</div>`;
  }

  // Pick a tasteful, generic category photo for a listing thumbnail.
  // Decorative only — derived from the listing's own category/name text, never fabricated data.
  const IMAGE_RULES = [
    [/bar|drink|beverage|cocktail|mixolog|wine/, 'bar'],
    [/cater|buffet|cuisine|food|chef/, 'catering'],
    [/menu|dinner|meal|dining|plate|course/, 'dining-plate'],
    [/pasta|italian|kitchen/, 'pasta'],
    [/floral|flower|bouquet|decor|stage|decoration|mandap/, 'bouquet'],
    [/wedding|bride|groom|marriage/, 'wedding-chairs'],
    [/birthday|balloon|party|kids/, 'balloons'],
    [/toast|guest|host|people|celebrat/, 'toast'],
    [/hall|banquet|conference|auditorium|hotel|resort|lawn|garden|venue|ballroom/, 'hall']
  ];
  function listingImage(mode, text) {
    const haystack = String(text || '').toLowerCase();
    for (const [pattern, name] of IMAGE_RULES) { if (pattern.test(haystack)) return name; }
    return mode === 'venues' ? 'wedding-table' : 'dining-plate';
  }

  function setUser(user, token) {
    state.user = user;
    state.token = token;
    state.events = [];
    if (user) {
      localStorage.setItem('gather_user', JSON.stringify(user));
      localStorage.setItem('gather_token', token);
    } else {
      localStorage.removeItem('gather_user');
      localStorage.removeItem('gather_token');
    }
    renderProfile();
    renderEvents();
  }

  function renderProfile() {
    const user = state.user;
    const role = user?.role;
    const host = role === 'HOST';
    const invitee = role === 'INVITEE';
    const name = user?.name || 'Guest planner';
    const initial = user?.name?.trim()?.charAt(0)?.toUpperCase() || 'G';
    $('#profile-name').textContent = name;
    $('#profile-role').textContent = user ? ({ HOST: 'Event host', VENDOR: 'Event vendor', INVITEE: 'Invited guest' }[role] || role.toLowerCase()) : 'Not signed in';
    $('#avatar').textContent = initial;
    $('#mini-avatar').textContent = initial;
    $('#top-user-name').textContent = user?.name?.split(' ')[0] || 'Guest';
    $('#user-chip').setAttribute('aria-label', user ? 'Switch Gather workspace view' : 'Sign in');
    $('#auth-action').textContent = user ? 'Sign out' : 'Sign in';
    $('#auth-action').setAttribute('aria-label', user ? 'Sign out' : 'Sign in');
    $('#page-title').innerHTML = invitee ? `Your next gathering<br><span>starts with an invite.</span>`
      : role === 'VENDOR' ? `Meet the people<br><span>behind the plans.</span>`
      : user ? `Let's make something<br><span>worth remembering.</span>`
      : `Good things start<br><span>with a plan.</span>`;
    $('#welcome-copy').textContent = !user ? 'Your next memorable moment is just a few details away.'
      : invitee ? `Welcome, ${name.split(' ')[0]}. Your invitations and event details will appear here.`
      : role === 'VENDOR' ? `Welcome, ${name.split(' ')[0]}. Explore the Gather marketplace and discover event opportunities.`
      : `Welcome back, ${name.split(' ')[0]}. Let's see what's coming together.`;
    $('#events-heading').textContent = invitee ? 'Invitations for you' : role === 'VENDOR' ? 'Your vendor workspace' : 'Coming together';
    $('[data-view="events"].nav-item span').textContent = invitee ? 'Invitations' : role === 'VENDOR' ? 'Marketplace' : 'My events';
    $('#all-events').style.display = role === 'VENDOR' ? 'none' : '';
    $('#hero-create').textContent = host || !user ? 'Plan your event' : invitee ? 'Find a place' : 'Explore the marketplace';
    $('#top-create').style.display = user && !host ? 'none' : '';
    $('#hero-create').setAttribute('aria-label', host || !user ? 'Plan an event' : 'Explore venues and services');
    $('.section-kicker').textContent = invitee ? 'Your invitations' : role === 'VENDOR' ? 'For your business' : 'Your plans';
    $('.discover-heading .section-kicker').textContent = invitee ? 'Planning inspiration' : role === 'VENDOR' ? 'Explore the marketplace' : 'A good place to start';
    $('.discover-heading h2').textContent = invitee ? 'Explore the details' : role === 'VENDOR' ? 'See what Gather offers' : 'Make it happen';
    $('#budget-title').innerHTML = host || !user ? 'Keep the plan<br>in perspective.' : invitee ? 'The details<br>come together.' : 'Find your next<br>opportunity.';
    $('.budget-panel .section-kicker').textContent = host || !user ? 'Budget snapshot' : invitee ? 'Your gathering' : 'Your marketplace';
    $('.note-panel .section-kicker').textContent = invitee ? 'A note for your day' : role === 'VENDOR' ? 'Grow your business' : 'A note for the day';
    $('.note-panel h3').innerHTML = invitee ? 'Enjoy the moment.<br>We’ll help with the details.' : role === 'VENDOR' ? 'Be part of<br>someone’s big day.' : 'Leave room for<br>the good stuff.';
    $('.note-panel p').textContent = invitee ? 'Check your invitation for the event date and details, then explore places and services for inspiration.' : role === 'VENDOR' ? 'Browse venues and services to see how Gather helps people bring their events together.' : 'Start with a date and a feeling. The rest can come together one good decision at a time.';
    $('#budget-link').textContent = host ? 'View your events →' : invitee ? 'Explore venues and services →' : 'Browse the marketplace →';
    if (!host) $('#budget-link').setAttribute('aria-label', invitee ? 'Explore venues and services' : 'Browse the marketplace');
    renderBudgetMessage();
  }

  function renderBudgetMessage(message) {
    const copy = $('#budget-copy');
    const values = $('#budget-values');
    const track = $('#budget-track');
    const eventName = $('#budget-event-name');
    values.classList.add('hidden');
    track.classList.add('hidden');
    eventName.classList.add('hidden');
    if (message) { copy.textContent = message; return; }
    if (!state.user) copy.textContent = 'Sign in as a host to see a real budget summary for your event.';
    else if (state.user.role === 'INVITEE') copy.textContent = 'When you are invited, the event details will appear in your invitations.';
    else if (state.user.role === 'VENDOR') copy.textContent = 'Discover the services and venues people use to bring events together.';
    else copy.textContent = 'Your event budget summary will appear here.';
  }

  function renderBudget(summary, event) {
    const budget = Number(summary.budget);
    const committed = Number(summary.committed_total);
    const remaining = Number(summary.budget_remaining);
    if (![budget, committed, remaining].every(Number.isFinite)) {
      renderBudgetMessage('A budget summary is not available for this event yet.');
      return;
    }
    $('#budget-copy').textContent = 'Based on the latest summary for your event.';
    $('#budget-remaining').textContent = formatAmount(remaining);
    $('#budget-values').classList.remove('hidden');
    $('#budget-track').classList.remove('hidden');
    $('#budget-event-name').textContent = event.name;
    $('#budget-event-name').classList.remove('hidden');
    const percentage = budget > 0 ? Math.max(0, Math.min(100, (committed / budget) * 100)) : (committed > 0 ? 100 : 0);
    $('#budget-fill').style.width = `${percentage}%`;
  }

  function renderEvents() {
    const container = $('#event-list');
    state.events = [];
    renderBudgetMessage();
    if (!state.token || !state.user) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">g</div><strong>Your plans will live here</strong><p>Sign in to see your events or start a new one.</p><button class="button button-primary" id="empty-auth" type="button">Get started <span aria-hidden="true">&rarr;</span></button></div>`;
      $('#empty-auth').addEventListener('click', () => openAuth('login'));
      return;
    }
    if (state.user.role === 'VENDOR') {
      renderVendorWorkspace(container);
      return;
    }
    if (state.user.role === 'INVITEE') {
      renderInvitations(container);
      return;
    }

    container.innerHTML = skeletonList(3);
    api('/api/events').then(events => {
      state.events = Array.isArray(events) ? events : [];
      const ordered = [...state.events].sort((first, second) => new Date(first.event_date) - new Date(second.event_date));
      if (state.user.role === 'HOST' && ordered.length) loadBudget(ordered);
      if (!ordered.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">g</div><strong>${state.user.role === 'HOST' ? 'Nothing on the calendar yet' : 'No invitations to show yet'}</strong><p>${state.user.role === 'HOST' ? 'Every lovely event starts somewhere.' : 'When you are invited to an event, it will appear here.'}</p>${state.user.role === 'HOST' ? '<button class="button button-primary" id="first-event" type="button">Plan an event <span aria-hidden="true">&rarr;</span></button>' : ''}</div>`;
        $('#first-event')?.addEventListener('click', () => eventModal.showModal());
        return;
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const upcoming = ordered.filter(item => new Date(`${String(item.event_date).slice(0, 10)}T12:00:00`) >= today);
      if (state.view !== 'events' && !upcoming.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">g</div><strong>No upcoming events</strong><p>Your past plans are saved. Browse all events to see them.</p><button class="button button-outline" id="show-all-events" type="button">View all events <span aria-hidden="true">&rarr;</span></button></div>`;
        $('#show-all-events').addEventListener('click', () => $('[data-view="events"].nav-item').click());
        return;
      }
      const visible = state.view === 'events' ? ordered : upcoming.slice(0, 3);
      container.innerHTML = visible.map(renderEventCard).join('');
    }).catch(error => {
      container.innerHTML = `<div class="empty-state"><strong>We couldn't load your plans</strong><p>${escapeHtml(error.message)}</p><button class="button button-outline" id="retry-events" type="button">Try again</button></div>`;
      $('#retry-events').addEventListener('click', renderEvents);
    });
  }

  async function renderVendorWorkspace(container) {
    container.innerHTML = `<div class="empty-state"><span class="section-kicker">Your services</span><strong>Show people what you offer</strong><p>Add the services, packages, or products you provide for events. They will appear in the Gather marketplace.</p><button class="button button-primary" id="add-offering" type="button">Add a service <span aria-hidden="true">+</span></button></div><div class="vendor-offering-list" id="vendor-offering-list" aria-live="polite"></div>`;
    $('#add-offering').addEventListener('click', openOfferingForm);
    const list = $('#vendor-offering-list');
    try {
      const offerings = await api('/api/offerings');
      if (!Array.isArray(offerings)) return;
      const mine = offerings.filter(item => String(item.vendor_id) === String(state.user.user_id));
      if (mine.length) list.innerHTML = `<h3 class="vendor-list-title">Your current listings</h3>${mine.map(item => `<article class="event-card"><div class="date-block"><span>${escapeHtml(String(item.offering_type || 'SERVICE').slice(0, 3))}</span><span>•</span></div><div class="event-info"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.category)}${item.price == null ? ' · Price on request' : ` · ${escapeHtml(formatAmount(item.price))}${item.pricing_unit ? ` ${escapeHtml(item.pricing_unit)}` : ''}`}</p></div><span class="event-status status-planned">${escapeHtml(item.offering_type)}</span></article>`).join('')}`;
    } catch (error) {
      list.innerHTML = `<p class="browse-hint">Your listings could not be loaded: ${escapeHtml(error.message)}</p>`;
    }
  }

  function openOfferingForm() {
    let dialog = $('#offering-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `<dialog class="modal" id="offering-modal" aria-labelledby="offering-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close dialog">&times;</button></form><div class="modal-kicker">Your vendor profile</div><h2 id="offering-title">Add a service.</h2><p class="modal-intro">Tell event hosts what you can bring to their celebration.</p><form id="offering-form" class="form-stack"><label>Business name<input name="business_name" required maxlength="120" placeholder="Gather & Co. Events"></label><div class="form-two"><label>Business location<input name="business_location" maxlength="160" placeholder="City or area"></label><label>Business description<input name="business_description" maxlength="500" placeholder="What does your business do?"></label></div><div class="form-two"><label>Service or package name<input name="name" required maxlength="120" placeholder="Garden dinner catering"></label><label>Category<input name="category" required maxlength="80" placeholder="Catering"></label></div><div class="form-two"><label>Listing type<select name="offering_type"><option value="SERVICE">Service</option><option value="PACKAGE">Package</option><option value="PRODUCT">Product</option></select></label><label>Price<input name="price" type="number" min="0" step="0.01" placeholder="Optional"></label></div><label>Service description<textarea name="description" rows="3" maxlength="1000" placeholder="What is included?"></textarea></label><div class="form-two"><label>Price unit<input name="pricing_unit" maxlength="40" placeholder="per guest, per hour"></label><label>Minimum guests<input name="min_capacity" type="number" min="1" placeholder="Optional"></label></div><label>Maximum guests<input name="max_capacity" type="number" min="1" placeholder="Optional"></label><button class="button button-primary full-button" type="submit">Publish service <span aria-hidden="true">&rarr;</span></button></form><p class="form-error" id="offering-error" role="alert"></p></dialog>`);
      dialog = $('#offering-modal');
      $('#offering-form').addEventListener('submit', async event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const profile = { business_name: values.business_name, business_location: values.business_location, description: values.business_description };
        const body = { ...values, price: values.price === '' ? null : Number(values.price), min_capacity: values.min_capacity === '' ? null : Number(values.min_capacity), max_capacity: values.max_capacity === '' ? null : Number(values.max_capacity) };
        const submit = $('#offering-form button[type="submit"]');
        submit.disabled = true;
        try {
          await api('/api/vendors/profile', { method: 'POST', body: JSON.stringify(profile) });
          await api('/api/offerings', { method: 'POST', body: JSON.stringify(body) });
          dialog.close();
          showToast('Your service is now listed in the marketplace.');
          renderVendorWorkspace($('#event-list'));
        } catch (error) {
          const message = $('#offering-error');
          message.textContent = error.message;
          message.classList.add('visible');
        } finally { submit.disabled = false; }
      });
    }
    $('#offering-form').reset();
    clearFormError('#offering-error');
    dialog.showModal();
    $('#offering-form [name="name"]').focus();
  }

  async function renderInvitations(container) {
    container.innerHTML = skeletonList(2);
    try {
      const invitations = await api('/api/invitations/mine');
      if (!Array.isArray(invitations) || !invitations.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">g</div><strong>No invitations yet</strong><p>When someone invites you to an event, you can open the invitation and respond here.</p></div>`;
        return;
      }
      container.innerHTML = invitations.map(invite => {
        const date = dateLabel(invite.event_date);
        const status = invite.rsvp_status || 'AWAITING RESPONSE';
        return `<button class="invitation-card" type="button" data-invitation-id="${escapeHtml(invite.invitation_id)}" data-event-id="${escapeHtml(invite.event_id)}"><span class="date-block"><span>${escapeHtml(date.month)}</span><span>${escapeHtml(date.day)}</span></span><span class="invitation-copy"><strong>${escapeHtml(invite.event_name)}</strong><span>${escapeHtml(invite.event_type)} · ${escapeHtml(date.full)}</span></span><span class="event-status status-${String(status).toLowerCase().replace(/[^a-z0-9]+/g, '-')}">${escapeHtml(status)}</span><span class="invitation-open">Open invitation →</span></button>`;
      }).join('');
      container.querySelectorAll('.invitation-card').forEach(card => card.addEventListener('click', () => openInvitation(card.dataset.invitationId, card.dataset.eventId)));
    } catch (error) {
      container.innerHTML = `<div class="empty-state"><strong>We couldn't load your invitations</strong><p>${escapeHtml(error.message)}</p><button class="button button-outline" type="button" id="retry-invitations">Try again</button></div>`;
      $('#retry-invitations').addEventListener('click', () => renderInvitations(container));
    }
  }

  async function openInvitation(invitationId, eventId) {
    let dialog = $('#invitation-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `<dialog class="modal" id="invitation-modal" aria-labelledby="invitation-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close invitation">&times;</button></form><div class="modal-kicker">You are invited</div><h2 id="invitation-title">Your invitation</h2><div id="invitation-details" class="invitation-details"></div><div class="invitation-actions"><button class="button button-primary" id="rsvp-accept" type="button">Accept invitation</button><button class="button button-outline" id="rsvp-decline" type="button">Decline</button></div><p class="form-error" id="invitation-error" role="alert"></p></dialog>`);
      dialog = $('#invitation-modal');
      for (const [buttonId, status] of [['rsvp-accept', 'ACCEPTED'], ['rsvp-decline', 'DECLINED']]) {
        $(`#${buttonId}`).addEventListener('click', async () => {
          try {
            await api(`/api/invitations/${encodeURIComponent(dialog.dataset.invitationId)}/rsvp`, { method: 'PATCH', body: JSON.stringify({ rsvp_status: status }) });
            dialog.close();
            showToast(status === 'ACCEPTED' ? 'You accepted the invitation.' : 'Your RSVP was updated.');
            renderInvitations($('#event-list'));
          } catch (error) { showFormError('#invitation-error', error.message); }
        });
      }
    }
    dialog.dataset.invitationId = invitationId;
    clearFormError('#invitation-error');
    $('#invitation-details').innerHTML = '<p class="browse-hint" role="status">Opening your invitation…</p>';
    dialog.showModal();
    try {
      const event = await api(`/api/events/${encodeURIComponent(eventId)}`);
      const date = dateLabel(event.event_date);
      const time = String(event.start_time || '').slice(0, 5);
      $('#invitation-title').textContent = event.name;
      $('#invitation-details').innerHTML = `<p class="invitation-event-type">${escapeHtml(event.event_type || 'Gathering')}</p><dl><div><dt>Date</dt><dd>${escapeHtml(date.full)}</dd></div><div><dt>Time</dt><dd>${escapeHtml(time || 'To be announced')}</dd></div><div><dt>Duration</dt><dd>${escapeHtml(event.duration_hours || '—')} hours</dd></div><div><dt>Guests</dt><dd>${escapeHtml(event.attendee_count || 'To be announced')}</dd></div></dl>`;
    } catch (error) { $('#invitation-details').innerHTML = `<p class="browse-hint">${escapeHtml(error.message)}</p>`; }
  }

  function renderEventCard(event) {
    const date = dateLabel(event.event_date);
    const details = [event.event_type, date.full, event.attendee_count ? `${event.attendee_count} guests` : null]
      .filter(Boolean).map(escapeHtml).join(' <span aria-hidden="true">&middot;</span> ');
    const status = String(event.status || 'planned');
    const statusClass = `status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const budget = event.budget != null ? `<span>Budget ${escapeHtml(formatAmount(event.budget))}</span>` : '';
    return `<article class="event-card"><div class="date-block"><span>${escapeHtml(date.month)}</span><span>${escapeHtml(date.day)}</span></div><div class="event-info"><strong>${escapeHtml(event.name)}</strong><p>${details}</p>${budget ? `<div class="event-meta">${budget}</div>` : ''}</div><span class="event-status ${statusClass}">${escapeHtml(status)}</span></article>`;
  }

  async function loadBudget(events) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const event = events.find(item => new Date(`${String(item.event_date).slice(0, 10)}T12:00:00`) >= today) || events[0];
    try {
      const summary = await api(`/api/events/${encodeURIComponent(event.event_id)}/budget`);
      renderBudget(summary, event);
    } catch (_error) {
      renderBudgetMessage('Budget details are not available for this event right now.');
    }
  }

  function openAuth(mode = 'login') {
    setAuthMode(mode);
    authModal.showModal();
    $('#auth-form [name="email"]').focus();
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    $$('.auth-tab').forEach(tab => {
      const selected = tab.dataset.authMode === mode;
      tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    const registering = mode === 'register';
    $('#name-field').classList.toggle('hidden', !registering);
    $('#role-field').classList.toggle('hidden', !registering);
    $('#name-field input').required = registering;
    $('#auth-title').textContent = registering ? "Let's get acquainted." : 'Come on in.';
    $('#auth-intro').textContent = registering
      ? 'A few details, then you can start planning.'
      : 'Sign in to see your plans and keep the good things moving.';
    $('#auth-submit').innerHTML = registering ? 'Create account <span aria-hidden="true">&rarr;</span>' : 'Sign in <span aria-hidden="true">&rarr;</span>';
    $('#auth-footnote').textContent = registering
      ? 'Already have an account? Choose Sign in above.'
      : 'New to Gather? Create an account to begin.';
    const passwordInput = $('#auth-form [name="password"]');
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    const passwordHint = $('#password-hint');
    if (registering) {
      passwordInput.minLength = 8;
      passwordInput.pattern = '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}';
      passwordHint.classList.remove('hidden');
    } else {
      passwordInput.removeAttribute('minlength');
      passwordInput.removeAttribute('pattern');
      passwordHint.classList.add('hidden');
    }
    clearFormError('#auth-error');
  }

  function clearFormError(selector) {
    const element = $(selector);
    element.textContent = '';
    element.classList.remove('visible');
  }

  function showFormError(selector, message) {
    const element = $(selector);
    element.textContent = message;
    element.classList.add('visible');
  }

  function beginEventCreation() {
    if (state.user?.role === 'HOST') { clearFormError('#event-error'); eventModal.showModal(); $('#event-form [name="name"]').focus(); }
    else if (state.user) openBrowse('venues');
    else openAuth('login');
  }

  function openBrowse(mode) {
    state.browseMode = mode;
    const venues = mode === 'venues';
    $('#browse-kicker').textContent = venues ? 'THE SETTING' : 'THE LITTLE DETAILS';
    $('#browse-title').textContent = venues ? 'Find a place.' : 'Find your people.';
    $('#browse-intro').textContent = venues
      ? 'Search for a setting that feels right for your day.'
      : 'Find services and packages from event vendors.';
    $('#browse-image').src = `/app-assets/images/${venues ? 'hall' : 'catering'}.jpg`;
    $('#browse-image').alt = venues ? 'A welcoming event venue ready for guests' : 'Food prepared for an event service';
    $('#browse-image-caption').textContent = venues ? 'Find a setting for your event' : 'Find services for your celebration';
    $('#browse-search').placeholder = venues ? 'Search by area or venue name' : 'Search by service or category';
    $('#browse-filters').innerHTML = venues
      ? '<label>Minimum capacity<input name="min_capacity" type="number" min="1" placeholder="Any"></label><label>Maximum price<input name="max_price" type="number" min="0" step="0.01" placeholder="Any"></label>'
      : '<label>Guest count<input name="attendees" type="number" min="1" placeholder="Any"></label><label>Maximum price<input name="max_price" type="number" min="0" step="0.01" placeholder="Any"></label>';
    $('#browse-results').innerHTML = '<p class="browse-hint">Tell us what you are looking for and we will find a few options.</p>';
    browseModal.showModal();
    $('#browse-search').focus();
  }

  async function browse(search = '', filters = {}) {
    const venues = state.browseMode === 'venues';
    const params = new URLSearchParams();
    if (search) params.set(venues ? 'location' : 'category', search);
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    const results = $('#browse-results');
    results.innerHTML = '<p class="browse-hint" role="status">Looking around...</p>';
    try {
      const items = await api(`${venues ? '/api/venues' : '/api/offerings'}?${params}`);
      if (!items.length) {
        results.innerHTML = '<p class="browse-hint">No matches just yet. Try another search.</p>';
        return;
      }
      results.innerHTML = items.map(item => {
        const description = venues
          ? [item.address, item.capacity ? `${item.capacity} guests` : '', item.business_name].filter(Boolean).join(' · ')
          : [item.category, item.description, item.business_name].filter(Boolean).join(' · ');
        const price = venues ? item.base_price : item.price;
        const id = venues ? item.venue_id : item.offering_id;
        const sample = String(item.business_name || '').includes('Sample Listings') ? '<span class="sample-badge">SAMPLE</span>' : '';
        const meta = venues
          ? [item.capacity ? `${escapeHtml(item.capacity)} guests` : '', price == null ? 'Price on request' : `From ${escapeHtml(formatAmount(price))}`].filter(Boolean).join(' · ')
          : `${escapeHtml(item.category)}${price == null ? ' · Price on request' : ` · ${escapeHtml(formatAmount(price))}${item.pricing_unit ? ` ${escapeHtml(item.pricing_unit)}` : ''}`}`;
        const imgName = listingImage(state.browseMode, `${item.category || ''} ${item.name || ''} ${item.address || ''}`);
        const thumb = `<span class="result-thumb"><img src="/app-assets/images/${imgName}.jpg" alt="" loading="lazy"></span>`;
        return `<article class="result-card">${thumb}<div class="result-copy">${sample}<strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(description)}</p></div><div class="result-side"><div class="result-meta">${meta}</div><button class="button button-outline listing-action" type="button" data-listing-type="${venues ? 'venue' : 'offering'}" data-listing-id="${escapeHtml(id)}">Select</button></div></article>`;
      }).join('');
      results.querySelectorAll('.listing-action').forEach(button => button.addEventListener('click', () => {
        const key = state.browseMode === 'venues' ? 'venue_id' : 'offering_id';
        const listing = items.find(item => String(item[key]) === button.dataset.listingId);
        if (listing) openBookingRequest(listing, state.browseMode);
      }));
    } catch (error) {
      results.innerHTML = `<p class="browse-hint">${escapeHtml(error.message)}. Make sure the API and database are running.</p>`;
    }
  }

  function openBookingRequest(listing, mode) {
    if (!state.user) { browseModal.close(); openAuth('login'); showToast('Sign in as a host to request a booking.'); return; }
    if (state.user.role !== 'HOST') { showToast('Only a host account can request a booking.'); return; }
    if (!state.events.length) { browseModal.close(); showToast('Create an event before requesting a booking.'); return; }
    state.selectedListing = { ...listing, mode };
    const venue = mode === 'venues';
    const bookingImage = listingImage(mode, `${listing.category || ''} ${listing.name || ''} ${listing.address || ''}`);
    $('#booking-image').src = `/app-assets/images/${bookingImage}.jpg`;
    $('#booking-image').alt = venue ? `A venue similar to ${listing.name}` : `An event service similar to ${listing.name}`;
    $('#booking-image-caption').textContent = venue ? 'A setting for your event' : 'A service for your celebration';
    $('#booking-title').textContent = venue ? 'Request this venue.' : 'Request this service.';
    $('#booking-kicker').textContent = venue ? 'THE SETTING' : 'THE LITTLE DETAILS';
    $('#booking-description').textContent = `${listing.name}${venue ? ` · Capacity ${listing.capacity}` : ` · ${listing.category}`}. This will create a pending booking request for the event you choose.`;
    const eventSelect = $('#booking-event');
    eventSelect.innerHTML = state.events.map(event => `<option value="${escapeHtml(event.event_id)}">${escapeHtml(event.name)} · ${escapeHtml(dateLabel(event.event_date).full)}</option>`).join('');
    const firstEvent = state.events[0];
    $('#booking-form [name="date"]').value = String(firstEvent.event_date).slice(0, 10);
    $('#booking-form [name="time"]').value = String(firstEvent.start_time || '10:00').slice(0, 5);
    $('#booking-form [name="duration_hours"]').value = Number(firstEvent.duration_hours) > 0 ? Number(firstEvent.duration_hours) : 4;
    $('#booking-form [name="agreed_price"]').value = '';
    clearFormError('#booking-error');
    browseModal.close();
    bookingModal.showModal();
  }

  function openRoleSwitcher() {
    if (!state.user) { window.location.assign('/login'); return; }
    let dialog = $('#role-switch-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `<dialog class="modal role-switch-modal" id="role-switch-modal" aria-labelledby="role-switch-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close dialog">&times;</button></form><div class="modal-kicker">One account, every point of view</div><h2 id="role-switch-title">Switch your Gather view.</h2><p class="modal-intro">Your plans, vendor listings, and invitations stay with this account.</p><div class="role-switch-options"><button type="button" data-role="HOST"><strong>Host</strong><span>Plan and manage events</span></button><button type="button" data-role="VENDOR"><strong>Vendor</strong><span>Add and manage services</span></button><button type="button" data-role="INVITEE"><strong>Invitee</strong><span>Open your invitations</span></button></div><p class="form-error" id="role-switch-error" role="alert"></p></dialog>`);
      dialog = $('#role-switch-modal');
      dialog.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', async () => {
        const requestedRole = button.dataset.role;
        if (requestedRole === state.user.role) { dialog.close(); return; }
        button.disabled = true;
        try {
          const result = await api('/api/auth/role', { method: 'PATCH', body: JSON.stringify({ role: requestedRole }) });
          state.view = 'home';
          setUser(result.user, state.token);
          $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'home'));
          $('#crumb-current').textContent = 'Overview';
          dialog.close();
          showToast(`Switched to your ${requestedRole.toLowerCase()} view.`);
        } catch (error) { showFormError('#role-switch-error', error.message); }
        finally { button.disabled = false; }
      }));
    }
    clearFormError('#role-switch-error');
    dialog.showModal();
  }

  $$('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
  $('#auth-action').addEventListener('click', () => state.user
    ? (setUser(null, null), showToast('You are signed out. See you soon.'))
    : openAuth('login'));
  $('#user-chip').addEventListener('click', openRoleSwitcher);
  $('#empty-auth').addEventListener('click', () => openAuth('login'));
  $('#top-create').addEventListener('click', beginEventCreation);
  $('#hero-create').addEventListener('click', beginEventCreation);

  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    clearFormError('#auth-error');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const mode = state.authMode;
    const submit = $('#auth-submit');
    submit.disabled = true;
    submit.textContent = mode === 'login' ? 'Signing in...' : 'Creating account...';
    try {
      if (mode === 'register') {
        const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
        setUser(result.user, result.token);
        authModal.close();
        showToast(`Account created. Welcome, ${result.user.name.split(' ')[0]}!`);
      } else {
        const result = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: body.email, password: body.password })
        });
        setUser(result.user, result.token);
        authModal.close();
        showToast(`Welcome, ${result.user.name.split(' ')[0]}!`);
      }
    } catch (error) { showFormError('#auth-error', error.message); }
    finally {
      submit.disabled = false;
      submit.innerHTML = state.authMode === 'register'
        ? 'Create account <span aria-hidden="true">&rarr;</span>'
        : 'Sign in <span aria-hidden="true">&rarr;</span>';
    }
  });

  $('#event-form').addEventListener('submit', async event => {
    event.preventDefault();
    clearFormError('#event-error');
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      ...form,
      duration_hours: Number(form.duration_hours),
      attendee_count: Number(form.attendee_count),
      budget: Number(form.budget)
    };
    try {
      await api('/api/events', { method: 'POST', body: JSON.stringify(payload) });
      eventModal.close();
      event.currentTarget.reset();
      showToast('Your event is on its way.');
      renderEvents();
    } catch (error) { showFormError('#event-error', error.message); }
  });

  $('#booking-event').addEventListener('change', event => {
    const selectedEvent = state.events.find(item => String(item.event_id) === event.currentTarget.value);
    if (!selectedEvent) return;
    $('#booking-form [name="date"]').value = String(selectedEvent.event_date).slice(0, 10);
    $('#booking-form [name="time"]').value = String(selectedEvent.start_time || '10:00').slice(0, 5);
    $('#booking-form [name="duration_hours"]').value = Number(selectedEvent.duration_hours) > 0 ? Number(selectedEvent.duration_hours) : 4;
  });

  $('#booking-form').addEventListener('submit', async event => {
    event.preventDefault();
    clearFormError('#booking-error');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const start = new Date(`${values.date}T${values.time}:00`);
    const end = new Date(start.getTime() + Number(values.duration_hours) * 60 * 60 * 1000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      showFormError('#booking-error', 'Choose a valid date, time, and duration.');
      return;
    }
    const sqlDateTime = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    const payload = {
      event_id: Number(values.event_id),
      venue_id: state.selectedListing.mode === 'venues' ? Number(state.selectedListing.venue_id) : null,
      offering_id: state.selectedListing.mode === 'offerings' ? Number(state.selectedListing.offering_id) : null,
      start_datetime: sqlDateTime(start),
      end_datetime: sqlDateTime(end),
      agreed_price: values.agreed_price === '' ? null : Number(values.agreed_price)
    };
    try {
      await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
      bookingModal.close();
      showToast('Booking request sent. It is now pending confirmation.');
    } catch (error) { showFormError('#booking-error', error.message); }
  });

  $('#browse-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const filters = Object.fromEntries($$('#browse-filters input').map(input => [input.name, input.value.trim()]));
    browse(String(form.get('search') || '').trim(), filters);
  });

  $$('[data-view]').forEach(button => button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (view === 'venues' || view === 'offerings') { openBrowse(view); return; }
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    state.view = view;
    $('#crumb-current').textContent = view === 'home' ? 'Overview' : state.user?.role === 'INVITEE' ? 'Invitations' : state.user?.role === 'VENDOR' ? 'Marketplace' : 'My events';
    $('#workspace-hero-image').src = view === 'events'
      ? '/app-assets/images/wedding-chairs.jpg'
      : '/app-assets/images/hero-dinner.jpg';
    $('#workspace-hero-image').alt = view === 'events'
      ? 'Chairs set up for guests at an event'
      : 'A candlelit celebration table set for guests';
    $('#workspace-hero-caption').textContent = view === 'events'
      ? 'Every event, in one place'
      : 'Make a day worth remembering';
    $('#page-title').innerHTML = view === 'events'
      ? state.user?.role === 'INVITEE' ? 'Your invitations,<br><span>all in one place.</span>'
        : state.user?.role === 'VENDOR' ? 'Your services,<br><span>in one place.</span>'
          : 'All the good things,<br><span>in one place.</span>'
      : state.user ? `Let's make something<br><span>worth remembering.</span>` : 'Good things start<br><span>with a plan.</span>';
    renderEvents();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  $('#all-events').addEventListener('click', () => $('[data-view="events"].nav-item').click());
  $('#budget-link').addEventListener('click', () => {
    if (!state.user) { openAuth('login'); return; }
    if (state.user.role === 'VENDOR') { openBrowse('offerings'); return; }
    if (state.user.role === 'INVITEE') { openBrowse('venues'); return; }
    $('[data-view="events"].nav-item').click();
    $('#events-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#today-label').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  }).format(new Date());
  renderProfile();
  renderEvents();
  const intent = new URLSearchParams(window.location.search).get('intent');
  if (intent) window.setTimeout(() => {
    if (intent === 'signin') openAuth('login');
    else if (intent === 'register') openAuth('register');
    else if (intent === 'create') beginEventCreation();
    else if (intent === 'venues' || intent === 'services') openBrowse(intent === 'services' ? 'offerings' : 'venues');
  }, 0);
})();
