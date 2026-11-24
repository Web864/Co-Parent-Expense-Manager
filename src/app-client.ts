import {policyLinks,policyVersion} from './policies';
/** Local-only replacement for AppDeploy's client SDK; preserves the original app's API. */
const request = async (method: string, path: string, input?: unknown) => {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: input === undefined ? {} : { 'Content-Type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'Request failed (' + response.status + ')');
  return { data };
};
export const api = {
  get: (url: string) => request('GET', url),
  post: (url: string, input?: unknown) => request('POST', url, input ?? {}),
  put: (url: string, input?: unknown) => request('PUT', url, input ?? {}),
  delete: (url: string) => request('DELETE', url),
};
function authScreen() {
  const holder = document.getElementById('app');
  if (!holder) return;
  holder.innerHTML = `
    <div class="cp-auth-scene"><div class="cp-auth-box">
      <div class="cp-auth-emblem"><img src="/favicon.svg" alt="CoParent Manager" width="56" height="56"></div>
      <h1>Welcome to CoParent Manager</h1>
      <p>Secure shared expenses, one family workspace.</p>
      <div class="cp-auth-tabs" role="group" aria-label="Account action">
        <button type="button" id="cp-signin-tab" class="active">Sign in</button>
        <button type="button" id="cp-signup-tab">Create account</button>
      </div>
      <form id="cp-auth-form" autocomplete="on">
        <label id="cp-name-label" hidden>Full name<input id="cp-auth-name" name="name" autocomplete="name" maxlength="50"></label>
        <label>Email address<input name="email" type="email" autocomplete="email" required maxlength="254"></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" minlength="10" required></label>
        <label id="cp-policy-label" hidden><input id="cp-policy-ack" type="checkbox" name="policyAcknowledged"> I have read the draft Privacy, Terms and Retention notices. These policies await owner/legal approval.</label>
        <p class="cp-auth-error" id="cp-auth-error" role="alert" aria-live="polite"></p>
        <button class="primary" id="cp-auth-submit" type="submit">Sign in</button>
      </form>
      <button type="button" class="secondary" id="cp-forgot-password">Forgot password?</button>
      ${policyLinks()}
      <p class="cp-auth-note">Each parent uses their own account. A workspace invitation connects both accounts.</p>
    </div></div>`;
  const form = holder.querySelector<HTMLFormElement>('#cp-auth-form')!;
  const label = holder.querySelector<HTMLElement>('#cp-name-label')!;
  const nameInput = holder.querySelector<HTMLInputElement>('#cp-auth-name')!;
  const password = form.querySelector<HTMLInputElement>('[name="password"]')!;
  const login = holder.querySelector<HTMLButtonElement>('#cp-signin-tab')!;
  const signup = holder.querySelector<HTMLButtonElement>('#cp-signup-tab')!;
  const submit = holder.querySelector<HTMLButtonElement>('#cp-auth-submit')!;
  const msg = holder.querySelector<HTMLElement>('#cp-auth-error')!;
  let mode: 'login' | 'signup' = 'login';
  const select = (next: 'login' | 'signup') => {
    mode = next;
    login.classList.toggle('active', next === 'login');
    signup.classList.toggle('active', next === 'signup');
    label.hidden = next === 'login';
    holder.querySelector<HTMLElement>('#cp-policy-label')!.hidden=next==='login';
    holder.querySelector<HTMLInputElement>('#cp-policy-ack')!.required=next==='signup';
    nameInput.required = next === 'signup';
    password.autocomplete = next === 'login' ? 'current-password' : 'new-password';
    submit.textContent = next === 'login' ? 'Sign in' : 'Create account';
    msg.textContent = '';
  };
  login.onclick = () => select('login');
  signup.onclick = () => select('signup');
  select('login');
  holder.querySelector<HTMLButtonElement>('#cp-forgot-password')!.onclick=()=>{
    holder.querySelector<HTMLHeadingElement>('h1')!.textContent='Recover your account';
    form.innerHTML='<label>Email address<input name="email" type="email" autocomplete="email" required></label><p id="cp-recovery-message" role="status"></p><button type="submit" class="primary">Send password reset link</button>';
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector<HTMLButtonElement>('button')!;button.disabled=true;try{const r=await api.post('/api/auth/forgot-password',{email:new FormData(form).get('email')});form.querySelector('#cp-recovery-message')!.textContent=r.data.message;}catch(err){form.querySelector('#cp-recovery-message')!.textContent=err instanceof Error?err.message:'Please retry.';}finally{button.disabled=false;}};
    login.onclick=()=>authScreen();signup.onclick=()=>{authScreen();document.getElementById('cp-signup-tab')?.click();};
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    submit.disabled = true;
    msg.textContent = '';
    try {
      await api.post('/api/auth/' + mode, {
        email: String(formData.get('email') || ''),
        password: String(formData.get('password') || ''),
        ...(mode === 'signup' ? { name: String(formData.get('name') || ''),policyAcknowledged:formData.get('policyAcknowledged')==='on',policyVersion } : {}),
      });
      if(mode==='signup'){select('login');msg.textContent='If eligible, a verification email will arrive. Sign in to continue; verify your email before sharing or managing account data.';submit.disabled=false;}else location.reload();
    } catch (error) {
      msg.textContent = error instanceof Error ? error.message : 'Could not sign in';
      submit.disabled = false;
    }
  };
};
export const auth = {
  async getUser() { const r = await api.get('/api/session'); return r.data.user; },
  async signInWithRedirect() { authScreen(); },
  async signOut() { await api.post('/api/auth/logout', {}); },
};
export const invitesClient = {
  getPendingCode() {
    const match = location.hash.match(/[?&]invite=([a-f0-9]{64})/i);
    if (match) { sessionStorage.setItem('cp-pending-invite', match[1]); return match[1]; }
    return sessionStorage.getItem('cp-pending-invite');
  },
  clearPendingCode() { sessionStorage.removeItem('cp-pending-invite'); },
  buildJoinUrl(code: string) { return location.origin + '/#/join?invite=' + encodeURIComponent(code); },
};
