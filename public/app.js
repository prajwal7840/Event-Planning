(() => {
  const state = {
    token: localStorage.getItem('gather_token'),
    user: readUser(),
    authMode: 'login',
    view: 'home',
    browseMode: 'venues',
    events: [],
    currentEvent: null,
    selectedListing: null,
    vendorBookings: [],
    budgetEventId: null,
    currentInviteEvent: null,
    currentEventBookings: [],
    inviteEventId: null,
    invitePosterFile: null,
    invitePosterUrl: null
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
  browseBack.textContent = '\u2190 Back to Gather';
  browseBack.addEventListener('click', () => browseModal.close());
  browseModal.prepend(browseBack);
  const bookingModal = $('#booking-modal');
  const eventDetailsModal = $('#event-details-modal');
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

  async function refreshNotificationBadge() {
    const trigger = $('#notification-trigger');
    trigger.classList.toggle('hidden', !state.user || !state.token);
    if (!state.user || !state.token) return;
    try {
      const items = await api('/api/notifications');
      const unread = Array.isArray(items) ? items.filter(item => !item.is_read).length : 0;
      const badge = $('#notification-count');
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
      trigger.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
    } catch { /* Keep the workspace usable if notifications are temporarily unavailable. */ }
  }

  async function openNotifications() {
    let dialog = $('#notifications-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', '<dialog class="modal notifications-modal" id="notifications-modal" aria-labelledby="notifications-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close notifications">&times;</button></form><div class="modal-kicker">Your updates</div><h2 id="notifications-title">Notifications.</h2><div id="notification-list" class="notification-list" aria-live="polite"></div></dialog>');
      dialog = $('#notifications-modal');
    }
    dialog.showModal();
    const list = $('#notification-list');
    list.innerHTML = '<p class="browse-hint">Loading updates…</p>';
    try {
      const items = await api('/api/notifications');
      list.innerHTML = items.length ? items.map(item => `<article class="notification-item ${item.is_read ? '' : 'notification-unread'}"><div><strong>${escapeHtml(item.notification_type.replaceAll('_', ' ').toLowerCase())}</strong><p>${escapeHtml(item.message)}</p><small>${escapeHtml(item.created_at)}</small></div>${item.is_read ? '' : `<button type="button" data-mark-notification="${escapeHtml(item.notification_id)}">Mark read</button>`}</article>`).join('') : '<p class="browse-hint">You have no updates yet.</p>';
      list.querySelectorAll('[data-mark-notification]').forEach(button => button.addEventListener('click', async () => {
        try { await api(`/api/notifications/${encodeURIComponent(button.dataset.markNotification)}/read`, { method: 'PATCH', body: JSON.stringify({}) }); await openNotificationsRefresh(dialog); }
        catch (error) { showToast(error.message); }
      }));
      refreshNotificationBadge();
    } catch (error) { list.innerHTML = `<p class="browse-hint">Could not load notifications: ${escapeHtml(error.message)}</p>`; }
  }

  async function openNotificationsRefresh(dialog) {
    const list = $('#notification-list');
    const items = await api('/api/notifications');
    list.innerHTML = items.length ? items.map(item => `<article class="notification-item ${item.is_read ? '' : 'notification-unread'}"><div><strong>${escapeHtml(item.notification_type.replaceAll('_', ' ').toLowerCase())}</strong><p>${escapeHtml(item.message)}</p><small>${escapeHtml(item.created_at)}</small></div>${item.is_read ? '' : `<button type="button" data-mark-notification="${escapeHtml(item.notification_id)}">Mark read</button>`}</article>`).join('') : '<p class="browse-hint">You have no updates yet.</p>';
    list.querySelectorAll('[data-mark-notification]').forEach(button => button.addEventListener('click', async () => {
      try { await api(`/api/notifications/${encodeURIComponent(button.dataset.markNotification)}/read`, { method: 'PATCH', body: JSON.stringify({}) }); await openNotificationsRefresh(dialog); }
      catch (error) { showToast(error.message); }
    }));
    await refreshNotificationBadge();
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

  function formatEventTimeRange(event) {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(event.start_time || ''));
    if (!match) return 'Time to be announced';
    const startMinutes = Number(match[1]) * 60 + Number(match[2]);
    const durationMinutes = Math.round(Number(event.duration_hours) * 60);
    const formatTime = minutes => {
      const normalized = ((minutes % 1440) + 1440) % 1440;
      const hour = Math.floor(normalized / 60);
      const minute = normalized % 60;
      return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
    };
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return formatTime(startMinutes);
    return `${formatTime(startMinutes)} - ${formatTime(startMinutes + durationMinutes)}`;
  }

  function formatAmount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--';
  }

  function formatFacilities(value) {
    let facilities = value;
    if (typeof facilities === 'string') {
      try { facilities = JSON.parse(facilities); } catch { /* keep plain text */ }
    }
    if (Array.isArray(facilities)) return facilities.join(', ');
    if (facilities && typeof facilities === 'object') return Object.values(facilities).join(', ');
    return String(facilities || '');
  }

  // Loading skeletons keep the workspace feeling responsive while data loads.
  function skeletonList(count = 3) {
    const card = '<div class="skeleton-card" aria-hidden="true"><div class="sk sk-date"></div><div><div class="sk sk-l1"></div><div class="sk sk-l2"></div></div><div class="sk sk-pill"></div></div>';
    return `<div class="loading" role="status"><span class="visually-hidden">Loading…</span>${card.repeat(count)}</div>`;
  }

  // Pick a tasteful, generic category photo for a listing thumbnail.
  // Decorative only ”? derived from the listing's own category/name text, never fabricated data.
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
    const vendor = role === 'VENDOR';
    const invitee = role === 'INVITEE';
    const vendorView = state.view === 'vendor-services' || state.view === 'vendor-bookings';
    if (vendor && !vendorView) state.view = 'vendor-services';
    else if (!vendor && vendorView) state.view = 'home';
    document.body.classList.toggle('vendor-mode', vendor);
    $('.right-column').style.display = '';
    $('.budget-panel').classList.toggle('hidden', vendor);
    $('.note-panel').classList.toggle('hidden', vendor);
    $('.vendor-booking-panel').classList.toggle('hidden', !vendor);
    for (const view of ['home', 'events', 'venues', 'offerings']) $('[data-view="' + view + '"]').classList.toggle('hidden', vendor);
    $('[data-view="invite"].nav-item').classList.toggle('hidden', vendor || invitee);
    for (const view of ['vendor-services', 'vendor-bookings']) $('[data-view="' + view + '"]').classList.toggle('hidden', !vendor);
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
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
    $('#page-title').innerHTML = vendor ? (state.view === 'vendor-bookings' ? `Your bookings<br><span>in one place.</span>` : `Your services<br><span>in one place.</span>`)
      : invitee ? `Your next gathering<br><span>starts with an invite.</span>`
      : user ? `Let's make something<br><span>worth remembering.</span>`
      : `Good things start<br><span>with a plan.</span>`;
    $('#welcome-copy').textContent = !user ? 'Your next memorable moment is just a few details away.'
      : invitee ? `Welcome, ${name.split(' ')[0]}. Your invitations and event details will appear here.`
      : vendor ? (state.view === 'vendor-bookings' ? `Welcome, ${name.split(' ')[0]}. Keep track of booking requests for your listings.` : `Welcome, ${name.split(' ')[0]}. Add and manage the services you offer for events.`)
      : `Welcome back, ${name.split(' ')[0]}. Let's see what's coming together.`;
    $('#events-heading').textContent = invitee ? 'Invitations for you' : vendor ? (state.view === 'vendor-bookings' ? 'Booking requests' : 'Your services') : 'Coming together';
    $('[data-view="events"].nav-item span').textContent = invitee ? 'Invitations' : 'My events';
    $('#crumb-current').textContent = vendor ? (state.view === 'vendor-bookings' ? 'My bookings' : 'My services') : state.view === 'invite' ? 'Invite guests' : state.view === 'home' ? 'Overview' : invitee ? 'Invitations' : 'My events';
    $('#all-events').style.display = vendor ? 'none' : '';
    $('#hero-create').textContent = host || !user ? 'Plan your event' : invitee ? 'Find a place' : 'Explore the marketplace';
    $('#top-create').style.display = user && !host ? 'none' : '';
    $('#hero-create').classList.toggle('hidden', vendor);
    $('#hero-create').setAttribute('aria-label', host || !user ? 'Plan an event' : 'Explore venues and services');
    $('.section-kicker').textContent = invitee ? 'Your invitations' : role === 'VENDOR' ? 'For your business' : 'Your plans';
    $('.discover-heading .section-kicker').textContent = invitee ? 'Planning inspiration' : vendor ? 'Explore the marketplace' : 'A good place to start';
    $('.discover-heading h2').textContent = invitee ? 'Explore the details' : vendor ? 'See what Gather offers' : 'Make it happen';
    $('#budget-title').innerHTML = host || !user ? 'Keep the plan<br>in perspective.' : invitee ? 'The details<br>come together.' : 'Find your next<br>opportunity.';
    $('.budget-panel .section-kicker').textContent = host || !user ? 'Budget snapshot' : invitee ? 'Your gathering' : 'Your marketplace';
    $('.note-panel .section-kicker').textContent = invitee ? 'A note for your day' : role === 'VENDOR' ? 'Grow your business' : 'A note for the day';
    $('.note-panel h3').innerHTML = invitee ? 'Enjoy the moment.<br>We’ll help with the details.' : role === 'VENDOR' ? 'Be part of<br>someone’s big day.' : 'Leave room for<br>the good stuff.';
    $('.note-panel p').textContent = invitee ? 'Check your invitation for the event date and details, then explore places and services for inspiration.' : role === 'VENDOR' ? 'Browse venues and services to see how Gather helps people bring their events together.' : 'Start with a date and a feeling. The rest can come together one good decision at a time.';
    $('#budget-link').textContent = host ? 'View your events →' : invitee ? 'Explore venues and services →' : 'Browse the marketplace →';
    if (!host) $('#budget-link').setAttribute('aria-label', invitee ? 'Explore venues and services' : 'Browse the marketplace');
    renderBudgetMessage();
    refreshNotificationBadge();
  }

  function renderBudgetMessage(message) {
    const copy = $('#budget-copy');
    const values = $('#budget-values');
    const track = $('#budget-track');
    const eventName = $('#budget-event-name');
    $('#budget-event-select').classList.add('hidden');
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
      if (state.view === 'vendor-bookings') renderVendorBookings(container);
      else renderVendorWorkspace(container);
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
      if (state.user.role === 'HOST' && ordered.length) {
        const budgetSelect = $('#budget-event-select');
        budgetSelect.innerHTML = ordered.map(item => `<option value="${escapeHtml(item.event_id)}">${escapeHtml(item.name)}</option>`).join('');
        budgetSelect.classList.remove('hidden');
        loadBudget(ordered, state.budgetEventId);
      }
      if (state.user.role === 'HOST' && state.view === 'invite') {
        renderInviteWorkspace(ordered);
        return;
      }
      if (!ordered.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">g</div><strong>${state.user.role === 'HOST' ? (state.view === 'invite' ? 'Create an event to invite guests' : 'Nothing on the calendar yet') : 'No invitations to show yet'}</strong><p>${state.user.role === 'HOST' ? (state.view === 'invite' ? 'Once you have an event, you can invite friends with its time and venue details.' : 'Every lovely event starts somewhere.') : 'When you are invited to an event, it will appear here.'}</p>${state.user.role === 'HOST' ? '<button class="button button-primary" id="first-event" type="button">Plan an event <span aria-hidden="true">&rarr;</span></button>' : ''}</div>`;
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
      container.querySelectorAll('[data-event-details]').forEach(button => button.addEventListener('click', () => {
        const selected = state.events.find(item => String(item.event_id) === button.dataset.eventDetails);
        if (selected) openEventDetails(selected);
      }));
    }).catch(error => {
      container.innerHTML = `<div class="empty-state"><strong>We couldn't load your plans</strong><p>${escapeHtml(error.message)}</p><button class="button button-outline" id="retry-events" type="button">Try again</button></div>`;
      $('#retry-events').addEventListener('click', renderEvents);
    });
  }

  async function renderVendorWorkspace(container) {
    loadVendorBookings();
    container.innerHTML = `<div class="empty-state"><span class="section-kicker">Your services</span><strong>Show people what you offer</strong><p>Add and maintain event services or venues. Set availability so hosts can find bookable times.</p><div class="vendor-list-actions"><button class="button button-primary" id="add-offering" type="button">Add a service <span aria-hidden="true">+</span></button><button class="button button-outline" id="add-venue" type="button">Add a venue <span aria-hidden="true">+</span></button></div></div><div class="vendor-offering-list" id="vendor-offering-list" aria-live="polite"></div>`;
    $('#add-offering').addEventListener('click', openOfferingForm);
    $('#add-venue').addEventListener('click', () => openVenueForm());
    const list = $('#vendor-offering-list');
    try {
      const offerings = await api('/api/offerings');
      if (!Array.isArray(offerings)) return;
      const mine = offerings.filter(item => String(item.vendor_id) === String(state.user.user_id));
      const vendorData = await api('/api/vendors/profile');
      if (mine.length) list.innerHTML = `<h3 class="vendor-list-title">Your current listings</h3>${mine.map(item => `<article class="event-card"><div class="date-block"><span>${escapeHtml(String(item.offering_type || 'SERVICE').slice(0, 3))}</span><span>•</span></div><div class="event-info"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.category)}${item.price == null ? ' · Price on request' : ` · ${escapeHtml(formatAmount(item.price))}${item.pricing_unit ? ` ${escapeHtml(item.pricing_unit)}` : ''}`}</p></div><span class="event-status status-planned">${escapeHtml(item.offering_type)}</span></article>`).join('')}`;
      const serviceCards = [...list.querySelectorAll('.event-card')];
      serviceCards.forEach((card, index) => {
        const item = mine[index];
        card.insertAdjacentHTML('afterend', `<div class="vendor-card-actions"><button type="button" data-edit-offering="${escapeHtml(item.offering_id)}">Edit</button><button type="button" data-availability-type="offering" data-availability-id="${escapeHtml(item.offering_id)}">Availability</button><button type="button" data-toggle-offering="${escapeHtml(item.offering_id)}" data-active="${item.is_active ? 'true' : 'false'}">${item.is_active ? 'Deactivate' : 'Activate'}</button></div>`);
      });
      if (vendorData.venues.length) list.insertAdjacentHTML('beforeend', `<h3 class="vendor-list-title">Your venues</h3>${vendorData.venues.map(item => `<article class="event-card"><div class="date-block"><span>VEN</span><span>•</span></div><div class="event-info"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.address)} · ${escapeHtml(item.capacity)} guests${item.base_price == null ? ' · Price on request' : ` · ${escapeHtml(formatAmount(item.base_price))}`}</p></div><span class="event-status status-confirmed">Venue</span></article><div class="vendor-card-actions"><button type="button" data-edit-venue="${escapeHtml(item.venue_id)}">Edit</button><button type="button" data-availability-type="venue" data-availability-id="${escapeHtml(item.venue_id)}">Availability</button></div>`).join('')}`);
      list.querySelectorAll('[data-edit-offering]').forEach(button => button.addEventListener('click', () => openOfferingForm({ ...mine.find(item => String(item.offering_id) === button.dataset.editOffering), business_name: vendorData.profile?.business_name || 'My business', business_location: vendorData.profile?.business_location, business_description: vendorData.profile?.description })));
      list.querySelectorAll('[data-edit-venue]').forEach(button => button.addEventListener('click', () => openVenueForm(vendorData.venues.find(item => String(item.venue_id) === button.dataset.editVenue))));
      list.querySelectorAll('[data-availability-type]').forEach(button => button.addEventListener('click', () => openAvailabilityForm(button.dataset.availabilityType, button.dataset.availabilityId)));
      list.querySelectorAll('[data-toggle-offering]').forEach(button => button.addEventListener('click', async () => {
        try {
          await api(`/api/offerings/${encodeURIComponent(button.dataset.toggleOffering)}`, { method: 'PATCH', body: JSON.stringify({ is_active: button.dataset.active !== 'true' }) });
          renderVendorWorkspace(container);
        } catch (error) { showToast(error.message); }
      }));
    } catch (error) {
      list.innerHTML = `<p class="browse-hint">Your listings could not be loaded: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function renderVendorBookings(container) {
    container.innerHTML = skeletonList(2);
    try {
      const bookings = await loadVendorBookings();
      if (!Array.isArray(bookings) || !bookings.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">g</div><strong>No booking requests yet</strong><p>Requests for your services will appear here with their event time and status.</p></div>';
        renderVendorMonthlySection(container);
        return;
      }
      const ordered = [...bookings].sort((a, b) => new Date(`${String(a.event_date).slice(0, 10)}T12:00:00`) - new Date(`${String(b.event_date).slice(0, 10)}T12:00:00`));
      container.innerHTML = `<h3 class="vendor-list-title">${ordered.length} booking request${ordered.length === 1 ? '' : 's'}</h3>${ordered.map(booking => {
        const date = dateLabel(String(booking.start_datetime || booking.event_date).slice(0, 10));
        const status = String(booking.status || 'PENDING');
        const statusClass = `status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const listing = booking.venue_name || booking.offering_name || 'Your listing';
        const time = String(booking.start_datetime || booking.event_start_time || '').slice(11, 16) || String(booking.event_start_time || '').slice(0, 5);
        const price = booking.booking_price == null ? 'Price to be agreed' : formatAmount(booking.booking_price);
        return `<button type="button" class="event-card vendor-booking-card" data-vendor-booking="${escapeHtml(booking.booking_id)}"><span class="date-block"><span>${escapeHtml(date.month)}</span><span>${escapeHtml(date.day)}</span></span><span class="event-info"><strong>${escapeHtml(booking.event_name || 'Event booking')}</strong><span class="vendor-card-subtitle">${escapeHtml(listing)} · ${escapeHtml(date.full)}${time ? ` at ${escapeHtml(time)}` : ''}</span><span class="event-meta"><span>${escapeHtml(price)}</span></span></span><span class="event-status ${statusClass}">${escapeHtml(status)}</span><span class="vendor-card-open">View details →</span></button>`;
      }).join('')}`;
      container.querySelectorAll('[data-vendor-booking]').forEach(button => button.addEventListener('click', () => {
        const booking = state.vendorBookings.find(item => String(item.booking_id) === button.dataset.vendorBooking);
        if (booking) openVendorBookingDetails(booking);
      }));
      container.querySelectorAll('[data-vendor-booking]').forEach(button => {
        const booking = state.vendorBookings.find(item => String(item.booking_id) === button.dataset.vendorBooking);
        if (!booking || String(booking.status).toUpperCase() !== 'PENDING') return;
        button.insertAdjacentHTML('afterend', `<div class="vendor-booking-actions"><label>Agreed price<input type="number" min="0" step="0.01" placeholder="Use listing price" data-confirm-price="${escapeHtml(booking.booking_id)}"></label><button type="button" class="button button-primary" data-confirm-booking="${escapeHtml(booking.booking_id)}">Confirm</button><button type="button" class="button button-outline" data-reject-booking="${escapeHtml(booking.booking_id)}">Reject</button></div>`);
      });
      container.querySelectorAll('[data-confirm-booking]').forEach(button => button.addEventListener('click', async () => {
        const bookingId = button.dataset.confirmBooking;
        const value = container.querySelector(`[data-confirm-price="${CSS.escape(bookingId)}"]`)?.value;
        try {
          await api(`/api/bookings/${encodeURIComponent(bookingId)}/confirm`, { method: 'PATCH', body: JSON.stringify({ agreed_price: value ? Number(value) : null }) });
          showToast('Booking confirmed.'); renderVendorBookings(container);
        } catch (error) { showToast(error.message); }
      }));
      container.querySelectorAll('[data-reject-booking]').forEach(button => button.addEventListener('click', async () => {
        try { await api(`/api/bookings/${encodeURIComponent(button.dataset.rejectBooking)}/reject`, { method: 'PATCH', body: JSON.stringify({}) }); showToast('Booking request rejected.'); renderVendorBookings(container); }
        catch (error) { showToast(error.message); }
      }));
      renderVendorMonthlySection(container);
    } catch (error) {
      container.innerHTML = `<div class="empty-state"><strong>We couldn't load your bookings</strong><p>${escapeHtml(error.message)}</p><button class="button button-outline" id="retry-vendor-bookings" type="button">Try again</button></div>`;
      $('#retry-vendor-bookings').addEventListener('click', () => renderVendorBookings(container));
    }
  }

  async function loadVendorBookings() {
    try {
      state.vendorBookings = await api('/api/bookings');
      if (!Array.isArray(state.vendorBookings)) state.vendorBookings = [];
      renderVendorBookingPanel();
      return state.vendorBookings;
    } catch (error) {
      $('#vendor-booking-stats').textContent = 'Booking activity is unavailable right now.';
      $('#vendor-booking-preview').innerHTML = `<span class="vendor-preview-empty">${escapeHtml(error.message)}</span>`;
      return [];
    }
  }

  function renderVendorBookingPanel() {
    const bookings = [...state.vendorBookings].sort((a, b) => new Date(`${String(a.start_datetime || a.event_date).slice(0, 10)}T12:00:00`) - new Date(`${String(b.start_datetime || b.event_date).slice(0, 10)}T12:00:00`));
    const pending = bookings.filter(item => String(item.status).toUpperCase() === 'PENDING').length;
    const confirmed = bookings.filter(item => String(item.status).toUpperCase() === 'CONFIRMED').length;
    const confirmedValue = bookings.filter(item => String(item.status).toUpperCase() === 'CONFIRMED').reduce((sum, item) => sum + (Number(item.booking_price) || 0), 0);
    $('#vendor-booking-stats').innerHTML = `<strong>${bookings.length}</strong> total booking${bookings.length === 1 ? '' : 's'} <span>${pending} pending · ${confirmed} confirmed</span><span class="vendor-earned-total">Confirmed booking value <b>${escapeHtml(formatAmount(confirmedValue))}</b></span>`;
    const preview = $('#vendor-booking-preview');
    if (!bookings.length) {
      preview.innerHTML = '<span class="vendor-preview-empty">No one has booked your services yet. New requests will appear here.</span>';
      return;
    }
    preview.innerHTML = bookings.slice(0, 3).map(booking => {
      const date = dateLabel(String(booking.start_datetime || booking.event_date).slice(0, 10));
      const time = String(booking.start_datetime || booking.event_start_time || '').slice(11, 16) || String(booking.event_start_time || '').slice(0, 5);
      const listing = booking.venue_name || booking.offering_name || 'Your listing';
      const price = booking.booking_price == null ? 'Price to be agreed' : formatAmount(booking.booking_price);
      return `<button type="button" class="vendor-preview-item" data-vendor-preview="${escapeHtml(booking.booking_id)}"><span><strong>${escapeHtml(booking.event_name || 'Event booking')}</strong><small>${escapeHtml(listing)} · ${escapeHtml(date.full)}${time ? ` · ${escapeHtml(time)}` : ''}</small></span><b>${escapeHtml(price)}</b></button>`;
    }).join('');
    preview.querySelectorAll('[data-vendor-preview]').forEach(button => button.addEventListener('click', () => {
      const booking = state.vendorBookings.find(item => String(item.booking_id) === button.dataset.vendorPreview);
      if (booking) openVendorBookingDetails(booking);
    }));
  }

  function renderVendorMonthlySection(container) {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(now);
    const monthly = state.vendorBookings.filter(booking => String(booking.start_datetime || booking.event_date || '').slice(0, 7) === monthKey);
    const earned = monthly.filter(item => String(item.status).toUpperCase() === 'CONFIRMED').reduce((sum, item) => sum + (Number(item.booking_price) || 0), 0);
    const rows = monthly.length ? monthly.map(booking => {
      const date = dateLabel(String(booking.start_datetime || booking.event_date).slice(0, 10));
      const listing = booking.venue_name || booking.offering_name || 'Your listing';
      const price = booking.booking_price == null ? 'Price to be agreed' : formatAmount(booking.booking_price);
      const status = String(booking.status || 'PENDING');
      return `<button type="button" class="vendor-month-row" data-vendor-month-booking="${escapeHtml(booking.booking_id)}"><span><strong>${escapeHtml(booking.event_name || 'Event booking')}</strong><small>${escapeHtml(listing)} · ${escapeHtml(date.full)}</small></span><span class="vendor-month-value">${escapeHtml(price)}<small>${escapeHtml(status)}</small></span></button>`;
    }).join('') : '<p class="vendor-month-empty">No bookings scheduled for this month.</p>';
    container.insertAdjacentHTML('beforeend', `<section class="vendor-monthly-section"><div class="vendor-month-heading"><div><div class="section-kicker">Monthly overview</div><h3>${escapeHtml(monthName)}</h3></div><div class="vendor-month-earned"><small>Confirmed value</small><strong>${escapeHtml(formatAmount(earned))}</strong></div></div><p class="vendor-month-note">${monthly.length} booking${monthly.length === 1 ? '' : 's'} scheduled this month · confirmed booking prices only count toward value.</p><div class="vendor-month-list">${rows}</div></section>`);
    container.querySelectorAll('[data-vendor-month-booking]').forEach(button => button.addEventListener('click', () => {
      const booking = state.vendorBookings.find(item => String(item.booking_id) === button.dataset.vendorMonthBooking);
      if (booking) openVendorBookingDetails(booking);
    }));
  }

  function openVendorBookingDetails(booking) {
    let dialog = $('#vendor-booking-details-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', '<dialog class="modal vendor-booking-details-modal" id="vendor-booking-details-modal" aria-labelledby="vendor-booking-details-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close dialog">&times;</button></form><div class="modal-kicker">Booking details</div><h2 id="vendor-booking-details-title"></h2><div id="vendor-booking-details-content" class="vendor-booking-details-content"></div></dialog>');
      dialog = $('#vendor-booking-details-modal');
    }
    const listing = booking.venue_name || booking.offering_name || 'Your listing';
    const date = dateLabel(booking.event_date);
    const start = String(booking.start_datetime || '').slice(11, 16) || String(booking.event_start_time || '').slice(0, 5);
    const end = String(booking.end_datetime || '').slice(11, 16);
    const time = start ? `${start}${end ? ` – ${end}` : ''}` : 'Time to be announced';
    const status = String(booking.status || 'PENDING');
    const price = booking.booking_price == null ? 'Price to be agreed' : formatAmount(booking.booking_price);
    $('#vendor-booking-details-title').textContent = booking.event_name || 'Event booking';
    $('#vendor-booking-details-content').innerHTML = `<div class="vendor-detail-status"><span class="event-status status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}">${escapeHtml(status)}</span></div><dl>${booking.host_name ? `<div><dt>Event host</dt><dd>${escapeHtml(booking.host_name)}</dd></div>` : ''}<div><dt>Service or venue</dt><dd>${escapeHtml(listing)}</dd></div>${booking.offering_category ? `<div><dt>Category</dt><dd>${escapeHtml(booking.offering_category)}</dd></div>` : ''}${booking.event_type ? `<div><dt>Celebration</dt><dd>${escapeHtml(booking.event_type)}</dd></div>` : ''}<div><dt>Event date</dt><dd>${escapeHtml(date.full)}</dd></div><div><dt>Event time</dt><dd>${escapeHtml(time)}</dd></div>${booking.attendee_count ? `<div><dt>Guest count</dt><dd>${escapeHtml(booking.attendee_count)}</dd></div>` : ''}<div><dt>Booking price</dt><dd>${escapeHtml(price)}</dd></div><div><dt>Request status</dt><dd>${escapeHtml(status)}</dd></div></dl>`;
    const details = $('#vendor-booking-details-content dl');
    if (booking.duration_hours) details.insertAdjacentHTML('beforeend', `<div><dt>Duration</dt><dd>${escapeHtml(booking.duration_hours)} hours</dd></div>`);
    if (booking.offering_description) details.insertAdjacentHTML('beforeend', `<div><dt>Service details</dt><dd>${escapeHtml(booking.offering_description)}</dd></div>`);
    if (booking.venue_address) details.insertAdjacentHTML('beforeend', `<div><dt>Venue address</dt><dd>${escapeHtml(booking.venue_address)}</dd></div>`);
    if (booking.venue_capacity) details.insertAdjacentHTML('beforeend', `<div><dt>Venue capacity</dt><dd>${escapeHtml(booking.venue_capacity)}</dd></div>`);
    dialog.showModal();
  }

  function openOfferingForm(existing = null) {
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
          if (existing) await api(`/api/offerings/${encodeURIComponent(existing.offering_id)}`, { method: 'PATCH', body: JSON.stringify(body) });
          else {
            await api('/api/vendors/profile', { method: 'POST', body: JSON.stringify(profile) });
            await api('/api/offerings', { method: 'POST', body: JSON.stringify(body) });
          }
          dialog.close();
          showToast(existing ? 'Your service was updated.' : 'Your service is now listed in the marketplace.');
          renderVendorWorkspace($('#event-list'));
        } catch (error) {
          const message = $('#offering-error');
          message.textContent = error.message;
          message.classList.add('visible');
        } finally { submit.disabled = false; }
      });
    }
    $('#offering-form').reset();
    $('#offering-title').textContent = existing ? 'Update your service.' : 'Add a service.';
    $('#offering-form button[type="submit"]').innerHTML = existing ? 'Save changes <span aria-hidden="true">→</span>' : 'Publish service <span aria-hidden="true">→</span>';
    if (existing) for (const [key, value] of Object.entries(existing)) {
      const input = $('#offering-form [name="' + key + '"]');
      if (input) input.value = value ?? '';
    }
    clearFormError('#offering-error');
    dialog.showModal();
    $('#offering-form [name="name"]').focus();
  }

  function openVenueForm(existing = null) {
    let dialog = $('#vendor-venue-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', '<dialog class="modal" id="vendor-venue-modal" aria-labelledby="vendor-venue-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close dialog">&times;</button></form><div class="modal-kicker">Your venue listing</div><h2 id="vendor-venue-title">Add a venue.</h2><p class="modal-intro">Add venue details hosts can use to find and book your space.</p><form id="vendor-venue-form" class="form-stack"><label>Business name<input name="business_name" required maxlength="160"></label><label>Business location<input name="business_location" maxlength="255"></label><label>Business description<input name="business_description" maxlength="500"></label><label>Venue name<input name="name" required maxlength="160"></label><label>Address<input name="address" required maxlength="500"></label><div class="form-two"><label>Capacity<input name="capacity" type="number" min="1" required></label><label>Base price<input name="base_price" type="number" min="0" step="0.01"></label></div><label>Facilities, separated by commas<input name="facilities" placeholder="Parking, accessible entrance"></label><button class="button button-primary full-button" type="submit">Save venue</button></form><p class="form-error" id="vendor-venue-error" role="alert"></p></dialog>');
      dialog = $('#vendor-venue-modal');
      $('#vendor-venue-form').addEventListener('submit', async event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const body = { ...values, capacity: Number(values.capacity), base_price: values.base_price === '' ? null : Number(values.base_price), facilities: values.facilities.split(',').map(item => item.trim()).filter(Boolean) };
        try {
          await api('/api/vendors/profile', { method: 'POST', body: JSON.stringify({ business_name: values.business_name, business_location: values.business_location, description: values.business_description }) });
          if (dialog.dataset.venueId) await api(`/api/venues/${encodeURIComponent(dialog.dataset.venueId)}`, { method: 'PATCH', body: JSON.stringify(body) });
          else await api('/api/venues', { method: 'POST', body: JSON.stringify(body) });
          dialog.close(); showToast(dialog.dataset.venueId ? 'Venue details updated.' : 'Venue added to your listings.'); renderVendorWorkspace($('#event-list'));
        } catch (error) { showFormError('#vendor-venue-error', error.message); }
      });
    }
    dialog.dataset.venueId = existing ? existing.venue_id : '';
    $('#vendor-venue-form').reset(); clearFormError('#vendor-venue-error');
    $('#vendor-venue-title').textContent = existing ? 'Update your venue.' : 'Add a venue.';
    $('#vendor-venue-form button[type="submit"]').textContent = existing ? 'Save changes' : 'Save venue';
    if (existing) {
      const fields = { ...existing, facilities: formatFacilities(existing.facilities) };
      for (const [key, value] of Object.entries(fields)) { const input = $('#vendor-venue-form [name="' + key + '"]'); if (input) input.value = value ?? ''; }
    }
    api('/api/vendors/profile').then(data => { if (data.profile) { $('#vendor-venue-form [name="business_name"]').value = data.profile.business_name; $('#vendor-venue-form [name="business_location"]').value = data.profile.business_location || ''; $('#vendor-venue-form [name="business_description"]').value = data.profile.description || ''; } }).catch(() => {});
    dialog.showModal();
  }

  async function openAvailabilityForm(type, id) {
    let dialog = $('#vendor-availability-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', '<dialog class="modal" id="vendor-availability-modal" aria-labelledby="vendor-availability-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close dialog">&times;</button></form><div class="modal-kicker">Availability calendar</div><h2 id="vendor-availability-title">Manage availability.</h2><p class="modal-intro">Add available hours or block time for a specific listing.</p><form id="vendor-availability-form" class="form-stack"><label>Start<input name="start_datetime" type="datetime-local" required></label><label>End<input name="end_datetime" type="datetime-local" required></label><label>Slot type<select name="availability_status"><option value="AVAILABLE">Available for booking</option><option value="BLOCKED">Blocked</option></select></label><button class="button button-primary full-button" type="submit">Add time slot</button></form><h3 class="vendor-list-title">Existing time slots</h3><div id="vendor-availability-list" class="vendor-availability-list"></div><p class="form-error" id="vendor-availability-error" role="alert"></p></dialog>');
      dialog = $('#vendor-availability-modal');
      $('#vendor-availability-form').addEventListener('submit', async event => {
        event.preventDefault(); const availabilityForm = event.currentTarget; const values = Object.fromEntries(new FormData(availabilityForm).entries());
        const toSql = value => `${value.replace('T', ' ')}:00`;
        const body = { [dialog.dataset.resourceType === 'venue' ? 'venue_id' : 'offering_id']: Number(dialog.dataset.resourceId), start_datetime: toSql(values.start_datetime), end_datetime: toSql(values.end_datetime), availability_status: values.availability_status };
        try { await api('/api/availability', { method: 'POST', body: JSON.stringify(body) }); availabilityForm.reset(); await refreshAvailability(dialog); showToast('Availability time saved.'); }
        catch (error) { showFormError('#vendor-availability-error', error.message); }
      });
    }
    dialog.dataset.resourceType = type; dialog.dataset.resourceId = id;
    $('#vendor-availability-form').reset(); clearFormError('#vendor-availability-error');
    $('#vendor-availability-title').textContent = `Manage ${type === 'venue' ? 'venue' : 'service'} availability.`;
    try { await refreshAvailability(dialog); dialog.showModal(); } catch (error) { showToast(error.message); }
  }

  async function refreshAvailability(dialog) {
    const rows = await api('/api/availability');
    const idField = dialog.dataset.resourceType === 'venue' ? 'venue_id' : 'offering_id';
    const rowsForResource = rows.filter(row => String(row[idField]) === dialog.dataset.resourceId);
    $('#vendor-availability-list').innerHTML = rowsForResource.length ? rowsForResource.map(slot => `<div class="vendor-availability-item"><span><strong>${escapeHtml(String(slot.start_datetime).slice(0, 16))} – ${escapeHtml(String(slot.end_datetime).slice(11, 16))}</strong><small>${escapeHtml(slot.availability_status)}</small></span><button type="button" data-toggle-slot="${escapeHtml(slot.slot_id)}" data-slot-status="${escapeHtml(slot.availability_status)}">Mark ${slot.availability_status === 'AVAILABLE' ? 'blocked' : 'available'}</button><button type="button" data-remove-slot="${escapeHtml(slot.slot_id)}">Remove</button></div>`).join('') : '<p class="browse-hint">No time slots set yet. Hosts can only confirm bookings covered by an available slot.</p>';
    $('#vendor-availability-list').querySelectorAll('[data-toggle-slot]').forEach(button => button.addEventListener('click', async () => {
      const nextStatus = button.dataset.slotStatus === 'AVAILABLE' ? 'BLOCKED' : 'AVAILABLE';
      try { await api(`/api/availability/${encodeURIComponent(button.dataset.toggleSlot)}`, { method: 'PATCH', body: JSON.stringify({ availability_status: nextStatus }) }); await refreshAvailability(dialog); }
      catch (error) { showFormError('#vendor-availability-error', error.message); }
    }));
    $('#vendor-availability-list').querySelectorAll('[data-remove-slot]').forEach(button => button.addEventListener('click', async () => {
      try { await api(`/api/availability/${encodeURIComponent(button.dataset.removeSlot)}`, { method: 'DELETE' }); await refreshAvailability(dialog); }
      catch (error) { showFormError('#vendor-availability-error', error.message); }
    }));
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
      const bookings = await api(`/api/events/${encodeURIComponent(eventId)}/bookings`).catch(() => []);
      $('#invitation-title').textContent = event.name;
      $('#invitation-details').innerHTML = `<p class="invitation-event-type">${escapeHtml(event.event_type || 'Gathering')}</p><dl><div><dt>Date</dt><dd>${escapeHtml(date.full)}</dd></div><div><dt>Time</dt><dd>${escapeHtml(time || 'To be announced')}</dd></div><div><dt>Duration</dt><dd>${escapeHtml(event.duration_hours ? `${event.duration_hours} hours` : 'To be announced')}</dd></div>${event.host_name ? `<div><dt>Hosted by</dt><dd>${escapeHtml(event.host_name)}</dd></div>` : ''}${event.host_phone ? `<div><dt>Contact</dt><dd><a href="tel:${escapeHtml(event.host_phone)}">${escapeHtml(event.host_phone)}</a></dd></div>` : ''}</dl><div class="invitation-selected-venue"><span class="section-kicker">VENUE &amp; LOCATION</span>${renderInvitationVenueDetails(bookings)}</div>`;
    } catch (error) { $('#invitation-details').innerHTML = `<p class="browse-hint">${escapeHtml(error.message)}</p>`; }
  }

  function renderEventCard(event) {
    const date = dateLabel(event.event_date);
    const details = [event.event_type, date.full, event.attendee_count ? `${event.attendee_count} guests` : null]
      .filter(Boolean).map(escapeHtml).join(' <span aria-hidden="true">&middot;</span> ');
    const status = String(event.status || 'planned');
    const statusClass = `status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const budget = event.budget != null ? `<span>Budget ${escapeHtml(formatAmount(event.budget))}</span>` : '';
    return `<article class="event-card"><div class="date-block"><span>${escapeHtml(date.month)}</span><span>${escapeHtml(date.day)}</span></div><div class="event-info"><strong>${escapeHtml(event.name)}</strong><p>${details}</p>${budget ? `<div class="event-meta">${budget}</div>` : ''}<button class="event-detail-action" type="button" data-event-details="${escapeHtml(event.event_id)}">View venue and services <span aria-hidden="true">→</span></button></div><span class="event-status ${statusClass}">${escapeHtml(status)}</span></article>`;
  }

  function renderInviteWorkspace(events) {
    const event = events.find(item => String(item.event_id) === String(state.inviteEventId)) || events[0];
    state.inviteEventId = String(event.event_id);
    containerInviteWorkspace(event);
  }

  function containerInviteWorkspace(selectedEvent) {
    const container = $('#event-list');
    const options = state.events.map(event => `<option value="${escapeHtml(event.event_id)}" ${String(event.event_id) === String(selectedEvent.event_id) ? 'selected' : ''}>${escapeHtml(event.name)}</option>`).join('');
    container.innerHTML = `<section class="invite-workspace">
      <div class="invite-workspace-heading"><span class="section-kicker">BRING YOUR PEOPLE TOGETHER</span><h3>Invite guests.</h3><p>Choose an event, confirm its venue, time, and location, then create a personal invitation poster.</p></div>
      <label class="invite-event-label">Event<select id="invite-workspace-event">${options}</select></label>
      <div class="invite-workspace-summary" id="invite-workspace-summary"><p class="browse-hint">Loading event time and venue details...</p></div>
      <section class="invite-rsvp-section" aria-labelledby="invite-rsvp-title"><div class="invite-rsvp-heading"><div><span class="section-kicker">GUEST LIST</span><h4 id="invite-rsvp-title">RSVPs</h4></div><strong class="invite-rsvp-total" id="invite-rsvp-total">0 invited</strong></div><div class="invite-rsvp-counts" id="invite-rsvp-counts"></div><div class="invite-rsvp-list" id="invite-rsvp-list" aria-live="polite"><p class="browse-hint">Loading guest responses...</p></div></section>
      <form id="invite-workspace-form" class="form-stack"><label>Friends' email addresses<textarea name="emails" rows="3" placeholder="alex@example.com, sam@example.com" required></textarea><small>Separate multiple addresses with commas or new lines. Invitees can RSVP in Gather using the same email address.</small></label><button class="button button-primary full-button" type="submit">Save invitations and create poster <span aria-hidden="true">→</span></button></form>
      <p class="form-error" id="invite-workspace-error" role="alert"></p><p class="invite-success hidden" id="invite-workspace-success" role="status"></p>
      <div class="invite-poster-preview hidden" id="invite-poster-preview"><img id="invite-poster-image" alt="Personalized event invitation poster"><div class="invite-poster-actions"><button class="button button-outline" type="button" id="download-invite-poster">Download poster</button><button class="button button-primary" type="button" id="share-invite-poster">Share poster</button></div></div>
    </section>`;
    const select = $('#invite-workspace-event');
    select.addEventListener('change', () => {
      state.inviteEventId = select.value;
      state.invitePosterFile = null;
      $('#invite-workspace-success').classList.add('hidden');
      $('#invite-poster-preview').classList.add('hidden');
      const changedEvent = state.events.find(item => String(item.event_id) === select.value);
      if (changedEvent) loadInviteWorkspaceDetails(changedEvent);
    });
    $('#invite-workspace-form').addEventListener('submit', async event => {
      event.preventDefault();
      await submitInvitations(event.currentTarget, '#invite-workspace-error', '#invite-workspace-success', '#invite-poster-preview');
    });
    $('#download-invite-poster').addEventListener('click', downloadInvitationPoster);
    $('#share-invite-poster').addEventListener('click', shareInvitationPoster);
    loadInviteWorkspaceDetails(selectedEvent);
  }

  async function loadInviteWorkspaceDetails(event) {
    state.currentInviteEvent = event;
    state.currentEventBookings = [];
    loadInviteRsvps(event.event_id);
    const summary = $('#invite-workspace-summary');
    if (!summary) return;
    const date = dateLabel(event.event_date).full;
    const time = formatEventTimeRange(event);
    summary.innerHTML = `<div class="invite-event-facts"><strong>${escapeHtml(event.name)}</strong><span>${escapeHtml(date)} - ${escapeHtml(time)}</span></div><div class="invite-venue-details"><p class="browse-hint">Loading venue and location...</p></div>`;
    try {
      const bookings = await api(`/api/events/${encodeURIComponent(event.event_id)}/bookings`);
      if (String(state.currentInviteEvent?.event_id) !== String(event.event_id)) return;
      state.currentEventBookings = bookings;
      summary.querySelector('.invite-venue-details').innerHTML = renderInvitationVenueDetails(bookings);
    } catch (error) {
      summary.querySelector('.invite-venue-details').innerHTML = `<p class="browse-hint">Could not load venue and location: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadInviteRsvps(eventId) {
    const list = $('#invite-rsvp-list');
    if (!list) return;
    list.innerHTML = '<p class="browse-hint">Loading guest responses...</p>';
    try {
      const invitations = await api(`/api/events/${encodeURIComponent(eventId)}/invitations`);
      if (String(state.currentInviteEvent?.event_id) !== String(eventId)) return;
      const counts = { PENDING: 0, ACCEPTED: 0, DECLINED: 0 };
      invitations.forEach(invitation => { counts[invitation.rsvp_status] = (counts[invitation.rsvp_status] || 0) + 1; });
      $('#invite-rsvp-total').textContent = `${invitations.length} invited`;
      $('#invite-rsvp-counts').innerHTML = `<span><strong>${counts.ACCEPTED || 0}</strong> Accepted</span><span><strong>${counts.PENDING || 0}</strong> Awaiting</span><span><strong>${counts.DECLINED || 0}</strong> Declined</span>`;
      if (!invitations.length) {
        list.innerHTML = '<p class="browse-hint">No guests invited yet. Add email addresses below to start your guest list.</p>';
        return;
      }
      list.innerHTML = invitations.map(invitation => {
        const status = invitation.rsvp_status || 'PENDING';
        const label = status === 'PENDING' ? 'Awaiting response' : status.charAt(0) + status.slice(1).toLowerCase();
        const delivery = invitation.delivery_error ? `Email failed; ${invitation.delivery_status === 'IN_APP' ? 'in-app invite delivered' : 'share poster manually'}: ${invitation.delivery_error}` : invitation.delivery_status === 'EMAIL_SENT' ? 'Email sent' : invitation.delivery_status === 'IN_APP' ? 'In-app invite sent' : invitation.delivery_status === 'FAILED' ? `Delivery failed${invitation.delivery_error ? `: ${invitation.delivery_error}` : ''}` : invitation.delivery_status === 'MANUAL_SHARE' ? 'Share poster manually' : 'Delivery pending';
        return `<article class="invite-rsvp-guest"><div><strong>${escapeHtml(invitation.invitee_name || invitation.invitee_email)}</strong>${invitation.invitee_name ? `<span>${escapeHtml(invitation.invitee_email)}</span>` : ''}<small>${escapeHtml(delivery)}</small></div><span class="event-status status-${status.toLowerCase()}">${escapeHtml(label)}</span></article>`;
      }).join('');
    } catch (error) {
      list.innerHTML = `<p class="browse-hint">Guest responses could not be loaded: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadBudget(events, preferredId = null) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const event = events.find(item => String(item.event_id) === String(preferredId)) ||
      events.find(item => new Date(`${String(item.event_date).slice(0, 10)}T12:00:00`) >= today) || events[0];
    state.budgetEventId = event.event_id;
    $('#budget-event-select').value = String(event.event_id);
    try {
      const summary = await api(`/api/events/${encodeURIComponent(event.event_id)}/budget`);
      renderBudget(summary, event);
    } catch (_error) {
      renderBudgetMessage('Budget details are not available for this event right now.');
    }
  }

  async function openEventDetails(event) {
    state.currentEvent = event;
    state.currentInviteEvent = event;
    state.currentEventBookings = [];
    $('#event-details-title').textContent = event.name;
    const date = dateLabel(event.event_date).full;
    $('#event-details-intro').textContent = [event.event_type, date, event.start_time ? String(event.start_time).slice(0, 5) : null,
      event.attendee_count ? `${event.attendee_count} guests` : null].filter(Boolean).join(' · ');
    if (state.user?.role === 'HOST') {
      if (!$('#manage-event-expenses')) {
        eventDetailsModal.insertAdjacentHTML('beforeend', '<button class="button button-outline manage-event-expenses" id="manage-event-expenses" type="button">Manage event expenses</button>');
        $('#manage-event-expenses').addEventListener('click', () => openExpenseManager(state.currentEvent));
      }
      $('#manage-event-expenses').classList.remove('hidden');
    }
    const list = $('#event-booking-details');
    list.innerHTML = '<p class="browse-hint" role="status">Loading selected venues and services…</p>';
    eventDetailsModal.showModal();
    try {
      const bookings = await api(`/api/events/${encodeURIComponent(event.event_id)}/bookings`);
      state.currentEventBookings = bookings;
      list.innerHTML = renderEventBookingItems(bookings);
      if (state.user?.role === 'HOST') bindHostBookingActions(list, bookings);
    } catch (error) {
      list.innerHTML = `<p class="browse-hint">Could not load event bookings: ${escapeHtml(error.message)}</p>`;
    }
  }

  function bindHostBookingActions(list, bookings) {
    list.querySelectorAll('[data-edit-booking]').forEach(button => button.addEventListener('click', () => {
      const booking = bookings.find(item => String(item.booking_id) === button.dataset.editBooking);
      if (booking) openBookingEdit(booking);
    }));
    list.querySelectorAll('[data-cancel-booking]').forEach(button => button.addEventListener('click', async () => {
      if (!window.confirm('Cancel this booking?')) return;
      try {
        await api(`/api/bookings/${encodeURIComponent(button.dataset.cancelBooking)}/cancel`, { method: 'PATCH', body: JSON.stringify({}) });
        showToast('Booking cancelled.'); await openEventDetails(state.currentEvent);
      } catch (error) { showToast(error.message); }
    }));
  }

  function openBookingEdit(booking) {
    let dialog = $('#booking-edit-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', '<dialog class="modal" id="booking-edit-modal" aria-labelledby="booking-edit-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close dialog">&times;</button></form><div class="modal-kicker">Pending request</div><h2 id="booking-edit-title">Update booking request.</h2><form id="booking-edit-form" class="form-stack"><div class="form-two"><label>Start<input name="start_datetime" type="datetime-local" required></label><label>End<input name="end_datetime" type="datetime-local" required></label></div><label>Agreed price, optional<input name="agreed_price" type="number" min="0" step="0.01"></label><button class="button button-primary full-button" type="submit">Save changes</button></form><p class="form-error" id="booking-edit-error" role="alert"></p></dialog>');
      dialog = $('#booking-edit-modal');
      $('#booking-edit-form').addEventListener('submit', async event => {
        event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const toSql = value => `${value.replace('T', ' ')}:00`;
        try {
          await api(`/api/bookings/${encodeURIComponent(dialog.dataset.bookingId)}`, { method: 'PATCH', body: JSON.stringify({ start_datetime: toSql(values.start_datetime), end_datetime: toSql(values.end_datetime), agreed_price: values.agreed_price === '' ? null : Number(values.agreed_price) }) });
          dialog.close(); eventDetailsModal.close(); showToast('Booking request updated.'); await openEventDetails(state.currentEvent);
        } catch (error) { showFormError('#booking-edit-error', error.message); }
      });
    }
    dialog.dataset.bookingId = booking.booking_id;
    $('#booking-edit-form [name="start_datetime"]').value = String(booking.start_datetime).replace(' ', 'T').slice(0, 16);
    $('#booking-edit-form [name="end_datetime"]').value = String(booking.end_datetime).replace(' ', 'T').slice(0, 16);
    $('#booking-edit-form [name="agreed_price"]').value = booking.agreed_price ?? '';
    clearFormError('#booking-edit-error'); dialog.showModal();
  }

  async function openExpenseManager(event) {
    let dialog = $('#expense-manager-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', '<dialog class="modal expense-manager-modal" id="expense-manager-modal" aria-labelledby="expense-manager-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close dialog">&times;</button></form><div class="modal-kicker">Event budget</div><h2 id="expense-manager-title">Track expenses.</h2><p class="modal-intro" id="expense-manager-intro"></p><div id="expense-manager-list" class="expense-manager-list"></div><form id="expense-manager-form" class="form-stack"><label>Description<input name="description" required maxlength="255" placeholder="Decorations"></label><div class="form-two"><label>Amount<input name="amount" type="number" min="0" step="0.01" required></label><label>Date<input name="expense_date" type="date"></label></div><label>Related booking, if any<select name="booking_id"><option value="">General event expense</option></select></label><button class="button button-primary full-button" type="submit">Add expense</button></form><p class="form-error" id="expense-manager-error" role="alert"></p></dialog>');
      dialog = $('#expense-manager-modal');
      $('#expense-manager-form').addEventListener('submit', async submitEvent => {
        submitEvent.preventDefault(); const expenseForm = submitEvent.currentTarget; const values = Object.fromEntries(new FormData(expenseForm).entries());
        const body = { ...values, amount: Number(values.amount), booking_id: values.booking_id || null };
        try {
          if (dialog.dataset.expenseId) await api(`/api/expenses/${encodeURIComponent(dialog.dataset.expenseId)}`, { method: 'PATCH', body: JSON.stringify(body) });
          else await api(`/api/events/${encodeURIComponent(dialog.dataset.eventId)}/expenses`, { method: 'POST', body: JSON.stringify(body) });
          dialog.dataset.expenseId = ''; expenseForm.reset(); await refreshExpenseManager(dialog); showToast('Expense saved to the event budget.');
        } catch (error) { showFormError('#expense-manager-error', error.message); }
      });
    }
    dialog.dataset.eventId = event.event_id;
    dialog.dataset.expenseId = '';
    $('#expense-manager-form').reset();
    $('#expense-manager-form button[type="submit"]').textContent = 'Add expense';
    $('#expense-manager-title').textContent = `Expenses for ${event.name}`;
    $('#expense-manager-intro').textContent = `Record event costs. Only expenses for this event are included in its budget.`;
    const select = $('#expense-manager-form [name="booking_id"]');
    select.innerHTML = '<option value="">General event expense</option>' + state.currentEventBookings.map(booking => `<option value="${escapeHtml(booking.booking_id)}">${escapeHtml(booking.venue_name || booking.offering_name || 'Booking')}</option>`).join('');
    clearFormError('#expense-manager-error');
    await refreshExpenseManager(dialog);
    dialog.showModal();
  }

  async function refreshExpenseManager(dialog) {
    const expenses = await api(`/api/events/${encodeURIComponent(dialog.dataset.eventId)}/expenses`);
    $('#expense-manager-list').innerHTML = expenses.length ? expenses.map(expense => `<article class="expense-item"><span><strong>${escapeHtml(expense.description)}</strong><small>${escapeHtml(expense.expense_date || 'Date not set')}</small></span><b>${escapeHtml(formatAmount(expense.amount))}</b><button type="button" data-edit-expense="${escapeHtml(expense.expense_id)}">Edit</button><button type="button" aria-label="Delete ${escapeHtml(expense.description)}" data-delete-expense="${escapeHtml(expense.expense_id)}">Remove</button></article>`).join('') : '<p class="browse-hint">No expenses recorded yet.</p>';
    $('#expense-manager-list').querySelectorAll('[data-edit-expense]').forEach(button => button.addEventListener('click', () => {
      const expense = expenses.find(item => String(item.expense_id) === button.dataset.editExpense);
      if (!expense) return;
      dialog.dataset.expenseId = expense.expense_id;
      const form = $('#expense-manager-form'); form.elements.description.value = expense.description; form.elements.amount.value = expense.amount;
      form.elements.expense_date.value = String(expense.expense_date || '').slice(0, 10); form.elements.booking_id.value = expense.booking_id || '';
      form.querySelector('[type="submit"]').textContent = 'Save expense changes';
    }));
    $('#expense-manager-list').querySelectorAll('[data-delete-expense]').forEach(button => button.addEventListener('click', async () => {
      try { await api(`/api/expenses/${encodeURIComponent(button.dataset.deleteExpense)}`, { method: 'DELETE' }); await refreshExpenseManager(dialog); }
      catch (error) { showFormError('#expense-manager-error', error.message); }
    }));
    const event = state.events.find(item => String(item.event_id) === dialog.dataset.eventId) || state.currentEvent;
    if (event) await loadBudget([event], String(event.event_id));
  }

  function renderEventBookingItems(bookings) {
    if (!bookings.length) return '<p class="browse-hint">No venue or service bookings selected for this event yet.</p>';
    return bookings.map(booking => {
      const venue = booking.venue_id != null;
      const name = venue ? booking.venue_name : booking.offering_name;
      const details = venue
        ? [booking.business_name, booking.venue_address, booking.venue_capacity ? `${booking.venue_capacity} guests` : null,
          booking.venue_facilities ? `Facilities: ${formatFacilities(booking.venue_facilities)}` : null]
        : [booking.business_name, booking.offering_category, booking.offering_type, booking.offering_description,
          booking.pricing_unit].filter(Boolean);
      const bookingTime = booking.start_datetime
        ? `${String(booking.start_datetime).slice(0, 16)}${booking.end_datetime ? ` – ${String(booking.end_datetime).slice(11, 16)}` : ''}` : null;
      if (bookingTime) details.push(bookingTime);
      const price = booking.estimated_price == null ? 'Price to be agreed' : formatAmount(booking.estimated_price);
      const status = String(booking.status || 'PENDING');
      const statusClass = `status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const controls = state.user?.role === 'HOST' && ['PENDING', 'CONFIRMED'].includes(status) ? `<div class="event-booking-actions">${status === 'PENDING' ? `<button type="button" data-edit-booking="${escapeHtml(booking.booking_id)}">Change request</button>` : ''}<button type="button" data-cancel-booking="${escapeHtml(booking.booking_id)}">Cancel booking</button></div>` : '';
      return `<article class="event-booking-item"><header><div><span class="section-kicker">${venue ? 'VENUE' : 'SERVICE'}</span><h3>${escapeHtml(name || 'Selected listing')}</h3></div><span class="event-status ${statusClass}">${escapeHtml(status)}</span></header><p>${details.map(escapeHtml).join(' · ') || 'Listing details'}</p><div class="event-booking-price">${escapeHtml(price)}</div>${controls}</article>`;
    }).join('');
  }

  function renderInvitationVenueDetails(bookings) {
    const venues = bookings.filter(booking => booking.venue_id != null);
    if (!venues.length) return '<p class="browse-hint">No venue has been selected yet.</p>';
    return venues.map(venue => {
      const address = venue.venue_address || 'Location to be announced';
      const map = venue.venue_address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.venue_address)}" target="_blank" rel="noreferrer">Open map</a>` : '';
      return `<article class="invite-venue-card"><span class="section-kicker">VENUE</span><strong>${escapeHtml(venue.venue_name || 'Selected venue')}</strong><span>${escapeHtml(address)}</span>${map}</article>`;
    }).join('');
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
    if (!$('#age-field')) $('#role-field').insertAdjacentHTML('afterend', '<label id="age-field" class="hidden">Your age<input name="age" type="number" min="1" max="120" placeholder="25" required></label><label id="phone-field" class="hidden">Phone number (optional)<input name="phone" type="tel" maxlength="30"></label><label id="city-field" class="hidden">City (optional)<input name="city" maxlength="100"></label><label id="share-phone-field" class="hidden"><span style="display:flex;align-items:center;gap:9px"><input name="share_phone_with_invitees" type="checkbox" value="true" style="width:16px;min-height:16px;margin:0;accent-color:#14362a"> Share my phone with people invited to my events</span></label>');
    for (const field of ['age', 'phone', 'city', 'share-phone']) $('#'+field+'-field').classList.toggle('hidden', !registering);
    $('#age-field input').required = registering;
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
      ? '<label>Guest count<input name="attendees" type="number" min="1" placeholder="Any"></label><label>Maximum price<input name="max_price" type="number" min="0" step="0.01" placeholder="Any"></label><label>Event date<input name="event_date" type="date"></label><label>Start time<input name="start_time" type="time"></label><label>Duration in hours<input name="duration_hours" type="number" min="0.5" step="0.5" placeholder="4"></label>'
      : '<label>Guest count<input name="attendees" type="number" min="1" placeholder="Any"></label><label>Maximum price<input name="max_price" type="number" min="0" step="0.01" placeholder="Any"></label><label>Event date<input name="event_date" type="date"></label><label>Start time<input name="start_time" type="time"></label><label>Duration in hours<input name="duration_hours" type="number" min="0.5" step="0.5" placeholder="4"></label>';
    const plannedEvent = state.events[0];
    if (plannedEvent) {
      $('#browse-filters [name="attendees"]').value = plannedEvent.attendee_count || '';
      $('#browse-filters [name="max_price"]').value = plannedEvent.budget || '';
      $('#browse-filters [name="event_date"]').value = String(plannedEvent.event_date || '').slice(0, 10);
      $('#browse-filters [name="start_time"]').value = String(plannedEvent.start_time || '').slice(0, 5);
      $('#browse-filters [name="duration_hours"]').value = plannedEvent.duration_hours || '';
    }
    $('#browse-results').innerHTML = '<p class="browse-hint">Tell us what you are looking for and we will find a few options.</p>';
    browseModal.showModal();
    $('#browse-search').focus();
  }

  async function browse(search = '', filters = {}) {
    const venues = state.browseMode === 'venues';
    const params = new URLSearchParams();
    if (search) params.set(venues ? 'location' : 'category', search);
    const { event_date, start_time, duration_hours, ...criteria } = filters;
    const hasAvailabilityFilter = Boolean(event_date || start_time || duration_hours);
    if (hasAvailabilityFilter) {
      if (!event_date || !start_time || !duration_hours || Number(duration_hours) <= 0) {
        $('#browse-results').innerHTML = '<p class="browse-hint">Enter an event date, start time, and duration together to check availability.</p>';
        return;
      }
      const start = new Date(`${event_date}T${start_time}:00`);
      const end = new Date(start.getTime() + Number(duration_hours) * 60 * 60 * 1000);
      if (Number.isNaN(start.getTime()) || !Number.isFinite(end.getTime())) {
        $('#browse-results').innerHTML = '<p class="browse-hint">Enter a valid event date and time.</p>';
        return;
      }
      const toSql = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
      params.set('start_datetime', toSql(start)); params.set('end_datetime', toSql(end));
    }
    Object.entries(criteria).forEach(([key, value]) => { if (value !== '') params.set(key, value); });
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
    if (!$('#profile-settings-open')) {
      dialog.insertAdjacentHTML('beforeend', '<button class="button button-outline profile-settings-open" id="profile-settings-open" type="button">Profile and privacy settings</button>');
      $('#profile-settings-open').addEventListener('click', () => openProfileSettings());
    }
    clearFormError('#role-switch-error');
    dialog.showModal();
  }

  async function openProfileSettings() {
    let dialog = $('#profile-settings-modal');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', '<dialog class="modal" id="profile-settings-modal" aria-labelledby="profile-settings-title"><form method="dialog" class="modal-close-form"><button class="modal-close" aria-label="Close settings">&times;</button></form><div class="modal-kicker">Your profile</div><h2 id="profile-settings-title">Contact and privacy.</h2><p class="modal-intro">Choose whether your phone number appears on invitations for your events.</p><form id="profile-settings-form" class="form-stack"><label>Phone number<input name="phone" type="tel" maxlength="30"></label><label>City<input name="city" maxlength="100"></label><label class="profile-share-choice"><span><input name="share_phone_with_invitees" type="checkbox"> Share my phone with people invited to my events</span></label><button class="button button-primary full-button" type="submit">Save profile</button></form><p class="form-error" id="profile-settings-error" role="alert"></p></dialog>');
      dialog = $('#profile-settings-modal');
      $('#profile-settings-form').addEventListener('submit', async event => {
        event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        const body = { phone: values.phone || null, city: values.city || null, share_phone_with_invitees: event.currentTarget.elements.share_phone_with_invitees.checked };
        try { const profile = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(body) }); dialog.close(); showToast('Profile settings saved.'); if (profile.user_id === state.user.user_id) state.user = { ...state.user, name: profile.name }; }
        catch (error) { showFormError('#profile-settings-error', error.message); }
      });
    }
    try {
      const profile = await api('/api/auth/profile');
      $('#profile-settings-form [name="phone"]').value = profile.phone || '';
      $('#profile-settings-form [name="city"]').value = profile.city || '';
      $('#profile-settings-form [name="share_phone_with_invitees"]').checked = Boolean(profile.share_phone_with_invitees);
      clearFormError('#profile-settings-error'); dialog.showModal();
    } catch (error) { showToast(error.message); }
  }

  $$('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
  $('#auth-action').addEventListener('click', () => state.user
    ? (setUser(null, null), showToast('You are signed out. See you soon.'))
    : openAuth('login'));
  $('#user-chip').addEventListener('click', openRoleSwitcher);
  $('#notification-trigger').addEventListener('click', openNotifications);
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
    const formElement = event.currentTarget;
    const form = Object.fromEntries(new FormData(formElement).entries());
    const payload = {
      ...form,
      duration_hours: Number(form.duration_hours),
      attendee_count: Number(form.attendee_count),
      budget: Number(form.budget)
    };
    try {
      await api('/api/events', { method: 'POST', body: JSON.stringify(payload) });
      eventModal.close();
      formElement.reset();
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

  $('#budget-event-select').addEventListener('change', event => {
    const selectedId = event.currentTarget.value;
    state.budgetEventId = selectedId;
    loadBudget(state.events, selectedId);
  });

  async function submitInvitations(form, errorSelector, successSelector, previewSelector) {
    if (!state.currentInviteEvent) return;
    const input = new FormData(form).get('emails') || '';
    const emails = [...new Set(String(input).split(/[\s,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    const error = $(errorSelector);
    error.textContent = '';
    error.classList.remove('visible');
    if (!emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      showFormError(errorSelector, 'Enter valid email addresses, separated by commas or new lines.');
      return;
    }
    if (emails.length > 25) {
      showFormError(errorSelector, 'Invite up to 25 friends at a time.');
      return;
    }
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    let saved = false;
    try {
      const savedInvitations = await api(`/api/events/${encodeURIComponent(state.currentInviteEvent.event_id)}/invitations`, {
        method: 'POST', body: JSON.stringify({ invitees: emails.map(email => ({ email })) })
      });
      saved = true;
      loadInviteRsvps(state.currentInviteEvent.event_id);
      const blob = await createInvitationPoster(state.currentInviteEvent, state.currentEventBookings);
      if (state.invitePosterUrl) URL.revokeObjectURL(state.invitePosterUrl);
      state.invitePosterUrl = URL.createObjectURL(blob);
      const safeName = String(state.currentInviteEvent.name || 'invitation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'invitation';
      state.invitePosterFile = new File([blob], `${safeName}-invitation.png`, { type: 'image/png' });
      $('#invite-poster-image').src = state.invitePosterUrl;
      const emailSent = savedInvitations.invitations.filter(item => item.delivery_status === 'EMAIL_SENT').length;
      const inApp = savedInvitations.invitations.filter(item => item.delivery_status === 'IN_APP').length;
      const failed = savedInvitations.invitations.filter(item => item.delivery_status === 'FAILED' || item.delivery_error).length;
      const posterShare = savedInvitations.invitations.filter(item => item.delivery_status === 'MANUAL_SHARE').length;
      $(successSelector).textContent = `${emails.length} invitation${emails.length === 1 ? '' : 's'} saved: ${emailSent} emailed, ${inApp} delivered in Gather, ${posterShare} need the poster shared manually, ${failed} delivery failures.`;
      $(successSelector).classList.remove('hidden');
      $(previewSelector).classList.remove('hidden');
    } catch (error) {
      showFormError(errorSelector, saved ? `Invitations were saved, but the poster could not be created: ${error.message}` : error.message);
    } finally { submit.disabled = false; }
  }

  function invitationShareText(event, bookings) {
    const date = dateLabel(event.event_date).full;
    const time = formatEventTimeRange(event);
    const venue = bookings.find(booking => booking.venue_id != null);
    const venueName = venue?.venue_name ? ` at ${venue.venue_name}` : '';
    const locationText = venue?.venue_address ? `${venueName}, ${venue.venue_address}` : venueName;
    return `You're invited to ${event.name} on ${date} at ${time}${locationText ? ` at ${locationText}` : ''}. Please RSVP in Gather using the invited email address.`;
  }

  async function createInvitationPoster(event, bookings) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not create the poster image.');
    const venue = bookings.find(booking => booking.venue_id != null);
    const date = dateLabel(event.event_date).full;
    const time = formatEventTimeRange(event);
    const ink = '#191813';
    const forest = '#14362a';
    const paper = '#fffdf6';
    const lime = '#cdf34f';
    const coral = '#ee6c4d';
    ctx.fillStyle = paper; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = forest; ctx.fillRect(0, 0, canvas.width, 555);
    ctx.fillStyle = '#1e4a39'; ctx.beginPath(); ctx.arc(955, 100, 190, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = coral; ctx.beginPath(); ctx.arc(1000, 445, 48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lime; ctx.beginPath(); ctx.arc(90, 510, 20, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = lime; ctx.font = '600 38px Arial, sans-serif'; ctx.fillText('gather.', 82, 95);
    ctx.fillStyle = paper; ctx.font = '600 24px Arial, sans-serif'; ctx.letterSpacing = '8px'; ctx.fillText("YOU'RE INVITED", 84, 180); ctx.letterSpacing = '0px';
    ctx.fillStyle = '#ffffff'; ctx.font = '500 76px Georgia, serif';
    const titleLines = wrapPosterText(ctx, event.name || 'A special gathering', 900, 3);
    titleLines.forEach((line, index) => ctx.fillText(line, 82, 292 + index * 91));
    ctx.fillStyle = lime; ctx.font = '500 29px Arial, sans-serif'; ctx.fillText(event.event_type || 'A Gather celebration', 84, Math.min(520, 325 + titleLines.length * 91));
    const sectionY = 680;
    ctx.fillStyle = coral; ctx.font = '600 23px Arial, sans-serif'; ctx.letterSpacing = '5px'; ctx.fillText('DATE & TIME', 84, sectionY); ctx.letterSpacing = '0px';
    ctx.fillStyle = ink; ctx.font = '500 43px Georgia, serif'; ctx.fillText(date, 84, sectionY + 68);
    ctx.font = '400 30px Arial, sans-serif'; ctx.fillText(time, 84, sectionY + 117);
    ctx.strokeStyle = '#e4ddca'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(84, sectionY + 164); ctx.lineTo(996, sectionY + 164); ctx.stroke();
    ctx.fillStyle = coral; ctx.font = '600 23px Arial, sans-serif'; ctx.letterSpacing = '5px'; ctx.fillText('WHERE', 84, sectionY + 220); ctx.letterSpacing = '0px';
    ctx.fillStyle = ink; ctx.font = '500 43px Georgia, serif';
    const venueLines = wrapPosterText(ctx, venue?.venue_name || 'Venue to be announced', 900, 2);
    venueLines.forEach((line, index) => ctx.fillText(line, 84, sectionY + 280 + index * 52));
    ctx.fillStyle = '#5f5b50'; ctx.font = '400 26px Arial, sans-serif';
    const addressLines = wrapPosterText(ctx, venue?.venue_address || 'Location to be announced', 900, 3);
    addressLines.forEach((line, index) => ctx.fillText(line, 84, sectionY + 340 + (venueLines.length - 1) * 52 + index * 36));
    ctx.fillStyle = forest; ctx.fillRect(0, 1190, canvas.width, 160);
    ctx.fillStyle = lime; ctx.font = '600 21px Arial, sans-serif'; ctx.fillText(`HOSTED BY ${String(state.user?.name || 'YOUR HOST').toUpperCase()}`, 84, 1252);
    ctx.fillStyle = paper; ctx.font = '400 20px Arial, sans-serif'; ctx.fillText('Please RSVP in your Gather account', 84, 1300);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Poster image export failed.')), 'image/png'));
  }

  function wrapPosterText(ctx, value, maxWidth, maxLines) {
    const words = String(value).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line); line = word;
        if (lines.length === maxLines) break;
      } else line = candidate;
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
      let last = lines[maxLines - 1];
      while (last.length && ctx.measureText(last + '...').width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last.trimEnd() + '...';
    }
    return lines;
  }

  function downloadInvitationPoster() {
    if (!state.invitePosterUrl || !state.invitePosterFile) return;
    const link = document.createElement('a'); link.href = state.invitePosterUrl; link.download = state.invitePosterFile.name; link.click();
  }

  async function shareInvitationPoster() {
    if (!state.invitePosterFile || !state.currentInviteEvent) return;
    const shareData = { files: [state.invitePosterFile], title: `You're invited: ${state.currentInviteEvent.name}`, text: invitationShareText(state.currentInviteEvent, state.currentEventBookings) };
    try {
      if (navigator.share && navigator.canShare?.({ files: shareData.files })) await navigator.share(shareData);
      else { downloadInvitationPoster(); showToast('Poster downloaded. Attach it to a message to send your invitation.'); }
    } catch (error) {
      if (error.name !== 'AbortError') showToast('Could not share the poster. Use Download poster instead.');
    }
  }

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
      state.budgetEventId = String(payload.event_id);
      renderEvents();
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
    if (state.user?.role === 'VENDOR' && !['vendor-services', 'vendor-bookings'].includes(view)) return;
    if (state.user?.role !== 'VENDOR' && ['vendor-services', 'vendor-bookings'].includes(view)) return;
    if (view === 'venues' || view === 'offerings') { openBrowse(view); return; }
    if (view === 'invite' && !state.user) { openAuth('login'); return; }
    if (view === 'invite' && state.user.role !== 'HOST') { showToast('Switch to a host workspace to invite guests.'); return; }
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    state.view = view;
    $('#crumb-current').textContent = view === 'home' ? 'Overview' : view === 'invite' ? 'Invite guests' : view === 'vendor-bookings' ? 'My bookings' : view === 'vendor-services' ? 'My services' : state.user?.role === 'INVITEE' ? 'Invitations' : state.user?.role === 'VENDOR' ? 'Marketplace' : 'My events';
    $('#workspace-hero-image').src = view === 'events'
      ? '/app-assets/images/wedding-chairs.jpg'
      : '/app-assets/images/hero-dinner.jpg';
    $('#workspace-hero-image').alt = view === 'events'
      ? 'Chairs set up for guests at an event'
      : 'A candlelit celebration table set for guests';
    $('#workspace-hero-caption').textContent = view === 'events'
      ? 'Every event, in one place'
      : 'Make a day worth remembering';
    $('#page-title').innerHTML = view === 'vendor-bookings' ? `Your bookings<br><span>in one place.</span>`
      : view === 'vendor-services' ? `Your services<br><span>in one place.</span>`
      : view === 'invite'
      ? 'Bring your people<br><span>into the plan.</span>'
      : view === 'events'
      ? state.user?.role === 'INVITEE' ? 'Your invitations,<br><span>all in one place.</span>'
        : state.user?.role === 'VENDOR' ? 'Your services,<br><span>in one place.</span>'
          : 'All the good things,<br><span>in one place.</span>'
      : state.user ? `Let's make something<br><span>worth remembering.</span>` : 'Good things start<br><span>with a plan.</span>';
    renderEvents();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  $('#all-events').addEventListener('click', () => $('[data-view="events"].nav-item').click());
  $('#vendor-view-bookings').addEventListener('click', () => $('[data-view="vendor-bookings"].nav-item').click());
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
