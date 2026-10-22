(() => {
  const $ = selector => document.querySelector(selector);
  const roleButtons = [...document.querySelectorAll('.role-choice')];
  const tabs = [...document.querySelectorAll('.form-tab')];
  const form = $('#account-form');
  const roleByParam = { host: 'HOST', vendor: 'VENDOR', invitee: 'INVITEE' };
  const params = new URLSearchParams(location.search);
  let role = roleByParam[(params.get('role') || '').toLowerCase()] || 'HOST';
  let mode = 'login';

  function setRole(nextRole) {
    role = nextRole;
    roleButtons.forEach(button => {
      const selected = button.dataset.role === role;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function setMode(nextMode) {
    mode = nextMode;
    tabs.forEach(tab => tab.classList.toggle('selected', tab.dataset.mode === mode));
    const registering = mode === 'register';
    $('#name-wrap').classList.toggle('is-hidden', !registering);
    $('#name-wrap input').required = registering;
    const password = form.elements.password;
    password.autocomplete = registering ? 'new-password' : 'current-password';
    password.minLength = registering ? 8 : 0;
    password.pattern = registering ? '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}' : '';
    $('#password-hint').classList.toggle('is-hidden', !registering);
    $('#form-title').textContent = registering ? 'Let’s get acquainted.' : 'Welcome back.';
    $('#form-intro').textContent = registering ? 'Create one account, then switch between Gather roles whenever you need.' : 'Choose how you would like to use Gather today.';
    $('#submit-button').innerHTML = registering ? 'Create account <span aria-hidden="true">&rarr;</span>' : 'Sign in <span aria-hidden="true">&rarr;</span>';
    $('#form-error').classList.remove('visible');
  }
  async function request(url, options = {}) {
    const { token, ...init } = options;
    const response = await fetch(url, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
    return data;
  }
  function finishLogin(user, token) {
    localStorage.setItem('gather_token', token);
    localStorage.setItem('gather_user', JSON.stringify(user));
    const next = params.get('next');
    location.assign(next && next.startsWith('/app') ? next : '/app');
  }

  roleButtons.forEach(button => button.addEventListener('click', () => setRole(button.dataset.role)));
  tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const button = $('#submit-button');
    const error = $('#form-error');
    error.classList.remove('visible');
    button.disabled = true;
    button.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';
    try {
      if (mode === 'register') {
        const result = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...values, role }) });
        finishLogin(result.user, result.token);
      } else {
        const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: values.email, password: values.password }) });
        let user = result.user;
        if (user.role !== role) {
          const switched = await request('/api/auth/role', { method: 'PATCH', token: result.token, body: JSON.stringify({ role }) });
          user = switched.user;
        }
        finishLogin(user, result.token);
      }
    } catch (err) {
      error.textContent = err.message;
      error.classList.add('visible');
    } finally {
      button.disabled = false;
      button.innerHTML = mode === 'login' ? 'Sign in <span aria-hidden="true">&rarr;</span>' : 'Create account <span aria-hidden="true">&rarr;</span>';
    }
  });
  setRole(role);
  setMode('login');
})();
