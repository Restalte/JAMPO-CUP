(() => {
  const KEY = 'jakuhouCupDataV8';
  const readyConfig = () => typeof window.JAMPO_SUPABASE_URL === 'string' &&
    window.JAMPO_SUPABASE_URL.startsWith('https://') && !window.JAMPO_SUPABASE_URL.includes('YOUR-PROJECT') &&
    typeof window.JAMPO_SUPABASE_ANON_KEY === 'string' && !window.JAMPO_SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');
  const configured = readyConfig() && window.supabase?.createClient;
  window.JAMPO_CLOUD_CONFIGURED = !!configured;
  if (!configured) {
    window.JAMPO_CLOUD = {configured:false, ready:Promise.resolve(), client:null, async save(){throw new Error('Supabaseの設定が未完了です。READMEの手順を確認してください。')}};
    if (location.pathname.endsWith('admin.html')) {
      document.addEventListener('DOMContentLoaded', () => {
        const app=document.getElementById('app'); if(app)app.style.display='none';
        const gate=document.createElement('div'); gate.style.cssText='position:fixed;inset:0;z-index:999999;background:#f7f5ed;display:grid;place-items:center;padding:20px;font-family:system-ui,sans-serif';
        gate.innerHTML='<div style="max-width:440px;background:#fff;padding:28px;border:1px solid #ddd;border-radius:16px"><h2>JAMPO CUP 管理画面</h2><p>公開前のクラウド設定がまだ完了していません。</p><p>supabase-config.js と README.txt の設定を完了してください。</p><a href="index.html">ホームへ戻る</a></div>';
        document.body.appendChild(gate);
      },{once:true});
    }
    return;
  }
  const client = window.supabase.createClient(window.JAMPO_SUPABASE_URL, window.JAMPO_SUPABASE_ANON_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  // A failed save must not poison the queue: later saves should still run.
  let saveQueue = Promise.resolve();
  let remoteHasData = false;
  let lastSaveState = { status: 'idle', message: 'まだ保存していません', at: null };
  function publishSaveState(status, message) {
    lastSaveState = { status, message, at: new Date().toISOString() };
    window.dispatchEvent(new CustomEvent('jampo-cloud-save-state', { detail: lastSaveState }));
  }
  async function readRemote() {
    const {data,error} = await client.from('jampo_site_data').select('data').eq('id',1).maybeSingle();
    if (error) throw error;
    if (data && data.data && typeof data.data === 'object') { remoteHasData = true; return data.data; }
    return null;
  }
  const stable = value => value && typeof value === 'object' ? (Array.isArray(value) ? '['+value.map(stable).join(',')+']' : '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}') : JSON.stringify(value);
  async function save(data) {
    // Recover from a previous rejected promise before enqueueing this write.
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      publishSaveState('saving', 'Supabaseへ保存中…');
      const {data:sessionData, error:sessionError} = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) throw new Error('管理者ログインが必要です。');
      // Ask Supabase to return the saved row so a successful HTTP request is verified.
      const {data:written, error} = await client
        .from('jampo_site_data')
        .upsert({id:1,data,updated_at:new Date().toISOString()},{onConflict:'id'})
        .select('id, updated_at')
        .single();
      if (error) throw error;
      if (!written || Number(written.id) !== 1) throw new Error('保存結果を確認できませんでした。');
      remoteHasData = true;
      publishSaveState('saved', 'クラウド保存成功');
      return written;
    }).catch(err => {
      publishSaveState('error', 'クラウド保存失敗: ' + (err?.message || '原因不明のエラー'));
      throw err;
    });
    return saveQueue;
  }
  // On each page navigation, hydrate localStorage from the shared row before the page's scripts render.
  const href = location.href;
  const marker = sessionStorage.getItem('jampo_cloud_reloaded_for');
  let ready = Promise.resolve();
  if (marker === href) {
    sessionStorage.removeItem('jampo_cloud_reloaded_for');
  } else {
    ready = readRemote().then(data => {
      if (data) {
        localStorage.setItem(KEY, JSON.stringify(data));
        sessionStorage.setItem('jampo_cloud_reloaded_for', href);
        location.reload();
      }
    }).catch(err => console.warn('[JAMPO cloud] Shared data could not be loaded:', err));
  }
  // Keep the existing site's localStorage-based feature code, but mirror authenticated writes to Supabase.
  const nativeSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key,value) {
    nativeSet.call(this,key,value);
    if (this === localStorage && key === KEY && window.JAMPO_CLOUD?.canWrite) {
      try { save(JSON.parse(value)).catch(err => { console.error('[JAMPO cloud] Save failed:', err); }); }
      catch(err) { publishSaveState('error', '保存データを読み取れませんでした'); console.error(err); }
    }
  };
  const nativeRemove = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function(key) {
    nativeRemove.call(this,key);
    if (this === localStorage && key === KEY && window.JAMPO_CLOUD?.canWrite) {
      save({}).catch(err => { console.error('[JAMPO cloud] Clear failed:', err); });
    }
  };
  window.JAMPO_CLOUD = {
    configured:true, client, ready, save, readRemote,
    get lastSaveState(){ return lastSaveState; },
    async waitForPendingSaves(){ return saveQueue; },
    async syncNow(){
      const latest = await readRemote();
      if (!latest) return { changed:false, data:null };
      let current = {}; try { current = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) {}
      if (stable(current) !== stable(latest)) { nativeSet.call(localStorage, KEY, JSON.stringify(latest)); return { changed:true, data:latest }; }
      return { changed:false, data:latest };
    },
    get canWrite(){return !!window.__JAMPO_ADMIN_AUTHENTICATED;},
    async isAdminUser(user){
      if(!user?.id)return false;
      const {data,error}=await client.from('jampo_admins').select('user_id').eq('user_id',user.id).maybeSingle();
      if(error)throw error;
      return !!data;
    },
    async login(email,password){
      const {data,error}=await client.auth.signInWithPassword({email,password});
      if(error)throw error;
      if(!(await this.isAdminUser(data.user))){await client.auth.signOut();window.__JAMPO_ADMIN_AUTHENTICATED=false;throw new Error('このアカウントには管理者権限がありません。');}
      window.__JAMPO_ADMIN_AUTHENTICATED=true;return data;
    },
    async logout(){await client.auth.signOut();window.__JAMPO_ADMIN_AUTHENTICATED=false;},
    async getSession(){
      const {data,error}=await client.auth.getSession();if(error)throw error;
      if(!data.session){window.__JAMPO_ADMIN_AUTHENTICATED=false;return null;}
      if(!(await this.isAdminUser(data.session.user))){await client.auth.signOut();window.__JAMPO_ADMIN_AUTHENTICATED=false;return null;}
      window.__JAMPO_ADMIN_AUTHENTICATED=true;return data.session;
    },
    async initializeDataIfEmpty(){
      const session=await client.auth.getSession();
      if(!session.data.session || !(await this.isAdminUser(session.data.session.user)))throw new Error('管理者権限が必要です。');
      const remote=await readRemote();
      if(!remote){const local=JSON.parse(localStorage.getItem(KEY)||'{}');await save(local);}
    }
  };
  // Visible sync indicator so an admin can distinguish local editing from a confirmed cloud save.
  function mountCloudStatus() {
    if (document.getElementById('jampo-cloud-status')) return;
    const el = document.createElement('div');
    el.id = 'jampo-cloud-status';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:999990;max-width:min(420px,calc(100vw - 28px));padding:9px 13px;border-radius:10px;background:#242424;color:#fff;font:12px/1.45 system-ui,sans-serif;box-shadow:0 4px 18px #0003;display:none;white-space:normal;overflow-wrap:anywhere';
    document.body.appendChild(el);
    const render = state => {
      el.style.display = 'block';
      el.textContent = state.message;
      el.style.background = state.status === 'error' ? '#8b1e1e' : state.status === 'saved' ? '#17633a' : '#242424';
    };
    window.addEventListener('jampo-cloud-save-state', e => render(e.detail));
    if (window.JAMPO_CLOUD?.lastSaveState?.status !== 'idle') render(window.JAMPO_CLOUD.lastSaveState);
  }
  // Public pages automatically refresh when another admin saves shared data.
  if (!(location.pathname.endsWith('/admin.html') || location.pathname.endsWith('admin.html'))) {
    setInterval(async () => {
      try {
        const latest = await readRemote();
        if (!latest) return;
        const current = localStorage.getItem(KEY);
        let currentData = {}; try { currentData = JSON.parse(current || '{}'); } catch (_) {}
        if (stable(currentData) !== stable(latest)) {
          nativeSet.call(localStorage, KEY, JSON.stringify(latest));
          location.reload();
        }
      } catch (e) { console.warn('[JAMPO cloud] Refresh check failed:', e); }
    }, 30000);
  }
  // Admin pages are gated immediately; database RLS remains the actual security boundary.
  if (location.pathname.endsWith('/admin.html') || location.pathname.endsWith('admin.html')) {
    document.documentElement.style.visibility='hidden';
    document.addEventListener('DOMContentLoaded', async () => {
      document.documentElement.style.visibility='visible';
      const gate=document.createElement('div'); gate.id='jampo-auth-gate';
      gate.style.cssText='position:fixed;inset:0;z-index:999999;background:#f7f5ed;display:grid;place-items:center;padding:20px;font-family:system-ui,sans-serif';
      gate.innerHTML=`<form id="jampo-login-form" style="box-sizing:border-box;width:min(420px,100%);background:white;padding:28px;border:1px solid #ddd;border-radius:16px;box-shadow:0 12px 40px #0001"><h2 style="margin-top:0">JAMPO CUP 管理者ログイン</h2><p style="color:#555">管理者アカウントでログインしてください。</p><label style="display:block;margin:14px 0 5px">メールアドレス</label><input id="jampo-admin-email" type="email" autocomplete="username" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #bbb;border-radius:8px"><label style="display:block;margin:14px 0 5px">パスワード</label><input id="jampo-admin-password" type="password" autocomplete="current-password" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #bbb;border-radius:8px"><button style="margin-top:18px;width:100%;padding:12px;background:#ffd900;border:0;border-radius:8px;font-weight:800;cursor:pointer">ログイン</button><p id="jampo-login-error" style="color:#b00020;white-space:pre-wrap"></p><p style="font-size:12px;color:#666">初回設定はREADMEのSupabase手順が必要です。</p><a href="index.html">ホームへ戻る</a></form>`;
      document.body.appendChild(gate);
      if(!window.JAMPO_CLOUD_CONFIGURED){document.getElementById('jampo-login-error').textContent='クラウド設定が未完了です。supabase-config.js と README の設定を完了してください。';return;}
      const app=document.getElementById('app'); if(app)app.style.display='none';
      try {const session=await window.JAMPO_CLOUD.getSession();if(session){await window.JAMPO_CLOUD.initializeDataIfEmpty();gate.remove();if(app)app.style.display='';mountCloudStatus();}} catch(e) {console.warn(e);}
      document.getElementById('jampo-login-form').addEventListener('submit',async e=>{
        e.preventDefault();const msg=document.getElementById('jampo-login-error');msg.textContent='ログイン中…';
        try{await window.JAMPO_CLOUD.login(document.getElementById('jampo-admin-email').value.trim(),document.getElementById('jampo-admin-password').value);await window.JAMPO_CLOUD.initializeDataIfEmpty();if(app)app.style.display='';gate.remove();mountCloudStatus();location.reload();}
        catch(err){msg.textContent='ログインできませんでした。メールアドレス・パスワード、Supabaseの設定を確認してください。';console.error(err);}
      });
    },{once:true});
  }
})();
