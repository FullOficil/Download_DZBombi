const state = {
  config: null,
  auth: null,
  user: null,
  account: null,
  downloading: false
};

const els = {};

window.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  await Promise.allSettled([loadConfig(), loadStats()]);
  await initFirebaseAuth();
}

function cacheElements() {
  [
    'accountButton', 'accountAvatar', 'accountText', 'downloadButton', 'downloadButtonText',
    'downloadMessage', 'downloadCount', 'gamePlatform', 'gameVersion', 'gameFile',
    'authModal', 'googleLoginButton', 'authError', 'accountModal', 'accountModalAvatar',
    'accountEmail', 'accountNick', 'logoutButton', 'imageModal', 'imageModalImg', 'imageModalClose', 'toast'
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.accountButton.addEventListener('click', () => {
    if (state.user) openModal(els.accountModal);
    else openModal(els.authModal);
  });

  els.downloadButton.addEventListener('click', onDownloadClick);
  els.googleLoginButton.addEventListener('click', signInGoogle);
  els.logoutButton.addEventListener('click', signOut);

  document.querySelectorAll('[data-close]').forEach((item) => {
    item.addEventListener('click', () => {
      const target = item.dataset.close === 'auth' ? els.authModal : els.accountModal;
      closeModal(target);
    });
  });

  document.querySelectorAll('.screen[data-image]').forEach((button) => {
    button.addEventListener('click', () => {
      els.imageModalImg.src = button.dataset.image;
      els.imageModal.hidden = false;
      document.body.style.overflow = 'hidden';
    });
  });

  els.imageModalClose.addEventListener('click', closeImageModal);
  els.imageModal.addEventListener('click', (event) => {
    if (event.target === els.imageModal) closeImageModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal(els.authModal);
      closeModal(els.accountModal);
      closeImageModal();
    }
  });
}

async function loadConfig() {
  const response = await fetch('/api/configuracao-publica', { cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível carregar a configuração do site.');
  state.config = await response.json();

  const jogo = state.config?.jogo || {};
  els.gamePlatform.textContent = jogo.plataforma || 'Android';
  els.gameVersion.textContent = jogo.versao || '—';
  els.gameFile.textContent = extensaoArquivo(jogo.arquivo || '') || 'APK';

  if (!state.config.downloadDisponivel) {
    els.downloadButton.disabled = true;
    els.downloadButtonText.textContent = 'Download indisponível';
    setDownloadMessage('O administrador ainda precisa configurar o arquivo do jogo.', 'error');
  }
}

async function loadStats() {
  try {
    const response = await fetch('/api/estatisticas', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    renderStats(data);
  } catch (_) {
    els.downloadCount.textContent = '—';
  }
}

function renderStats(data) {
  els.downloadCount.textContent = formatNumber(data?.totalDownloads);
}

async function initFirebaseAuth() {
  if (!state.config?.firebaseWebConfig || !window.firebase) {
    disableAuth('Login indisponível. Verifique a configuração do Firebase.');
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(state.config.firebaseWebConfig);
    state.auth = firebase.auth();
    state.auth.useDeviceLanguage();
    await state.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    state.auth.onAuthStateChanged(async (user) => {
      state.user = user || null;
      state.account = null;

      if (!user) {
        renderLoggedOut();
        return;
      }

      renderUserShell(user);
      await loadMyAccount();
    });
  } catch (error) {
    console.error('[Auth]', error);
    disableAuth(firebaseErrorMessage(error));
  }
}

function disableAuth(message) {
  els.accountText.textContent = 'Login indisponível';
  els.accountButton.disabled = true;
  els.googleLoginButton.disabled = true;
  if (state.config?.downloadDisponivel) {
    els.downloadButton.disabled = true;
    els.downloadButtonText.textContent = 'Login indisponível';
  }
  els.authError.textContent = message;
}

async function signInGoogle() {
  els.authError.textContent = '';
  if (!state.auth) {
    els.authError.textContent = 'O login não foi inicializado.';
    return;
  }

  const original = els.googleLoginButton.innerHTML;
  els.googleLoginButton.disabled = true;
  els.googleLoginButton.textContent = 'Abrindo login...';

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await state.auth.signInWithPopup(provider);
    closeModal(els.authModal);
    showToast('Conta conectada. Agora você pode baixar o jogo.');
  } catch (error) {
    console.error('[Login]', error);
    els.authError.textContent = firebaseErrorMessage(error);
  } finally {
    els.googleLoginButton.disabled = false;
    els.googleLoginButton.innerHTML = original;
  }
}

async function signOut() {
  if (!state.auth) return;
  try {
    await state.auth.signOut();
    closeModal(els.accountModal);
    showToast('Você saiu da conta.');
  } catch (_) {
    showToast('Não foi possível sair da conta.');
  }
}

async function loadMyAccount() {
  if (!state.user) return;
  try {
    const token = await state.user.getIdToken();
    const response = await fetch('/api/minha-conta', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });

    if (!response.ok) {
      const data = await safeJson(response);
      throw new Error(data?.erro || 'Não foi possível consultar a conta.');
    }

    state.account = await response.json();
    renderAccountDetails();
  } catch (error) {
    console.error('[Conta]', error);
    els.accountNick.textContent = 'Não disponível';
  }
}

function renderLoggedOut() {
  setAvatar(els.accountAvatar, null, 'G');
  els.accountText.textContent = 'Entrar na conta';
  els.accountEmail.textContent = '—';
  els.accountNick.textContent = 'Não registrado';

  if (state.config?.downloadDisponivel) {
    els.downloadButton.disabled = false;
    els.downloadButtonText.textContent = 'Entrar para baixar';
  }
  setDownloadMessage('Faça login para liberar o download.', '');
}

function renderUserShell(user) {
  const fallback = initialOf(user.displayName || user.email || 'G');
  setAvatar(els.accountAvatar, user.photoURL, fallback);
  els.accountText.textContent = user.displayName || user.email || 'Minha conta';

  if (state.config?.downloadDisponivel) {
    els.downloadButton.disabled = false;
    els.downloadButtonText.textContent = 'Baixar jogo';
  }
  setDownloadMessage('Conta autenticada. O download está liberado.', 'success');
}

function renderAccountDetails() {
  if (!state.user) return;
  const fallback = initialOf(state.user.displayName || state.user.email || 'G');
  setAvatar(els.accountModalAvatar, state.user.photoURL, fallback);
  els.accountEmail.textContent = state.user.email || '—';
  els.accountNick.textContent = state.account?.conta?.nick || 'Não registrado';
}

async function onDownloadClick() {
  if (!state.config?.downloadDisponivel) {
    setDownloadMessage('O download ainda não foi configurado pelo administrador.', 'error');
    return;
  }

  if (!state.user) {
    openModal(els.authModal);
    return;
  }

  if (state.downloading) return;
  state.downloading = true;
  els.downloadButton.disabled = true;
  els.downloadButtonText.textContent = 'Preparando...';
  setDownloadMessage('Validando sua conta e preparando o arquivo...', '');

  try {
    const token = await state.user.getIdToken(true);
    const response = await fetch('/api/iniciar-download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });

    const data = await safeJson(response);
    if (!response.ok) throw new Error(data?.erro || 'Não foi possível iniciar o download.');

    renderStats(data);
    setDownloadMessage(
      data.contabilizado
        ? 'Download registrado. O arquivo será iniciado agora.'
        : 'Download liberado. Este clique não aumentou o contador por ter ocorrido há poucos segundos.',
      'success'
    );

    window.location.assign(data.downloadUrl);
  } catch (error) {
    console.error('[Download]', error);
    setDownloadMessage(error.message || 'Não foi possível iniciar o download.', 'error');
  } finally {
    state.downloading = false;
    els.downloadButton.disabled = false;
    els.downloadButtonText.textContent = state.user ? 'Baixar jogo' : 'Entrar para baixar';
  }
}

function openModal(element) {
  if (!element) return;
  element.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal(element) {
  if (!element || element.hidden) return;
  element.hidden = true;
  if (els.authModal.hidden && els.accountModal.hidden && els.imageModal.hidden) {
    document.body.style.overflow = '';
  }
}

function closeImageModal() {
  if (els.imageModal.hidden) return;
  els.imageModal.hidden = true;
  els.imageModalImg.removeAttribute('src');
  if (els.authModal.hidden && els.accountModal.hidden) document.body.style.overflow = '';
}

function setDownloadMessage(message, type) {
  els.downloadMessage.textContent = message || '';
  els.downloadMessage.classList.remove('is-error', 'is-success');
  if (type === 'error') els.downloadMessage.classList.add('is-error');
  if (type === 'success') els.downloadMessage.classList.add('is-success');
}

function setAvatar(element, url, fallback) {
  if (!element) return;
  element.innerHTML = '';
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    element.appendChild(img);
  } else {
    element.textContent = fallback || 'G';
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

function formatNumber(value) {
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  return new Intl.NumberFormat('pt-BR').format(n);
}

function extensaoArquivo(name) {
  const raw = String(name || '').trim();
  const match = raw.match(/\.([a-z0-9]{2,6})$/i);
  return match ? match[1].toUpperCase() : raw;
}

function initialOf(value) {
  return String(value || 'G').trim().charAt(0).toUpperCase() || 'G';
}

async function safeJson(response) {
  try { return await response.json(); }
  catch (_) { return null; }
}

function firebaseErrorMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('popup-closed-by-user')) return 'A janela de login foi fechada.';
  if (code.includes('popup-blocked')) return 'O navegador bloqueou a janela de login.';
  if (code.includes('unauthorized-domain')) return 'Este domínio ainda não foi autorizado no Firebase Authentication.';
  if (code.includes('network-request-failed')) return 'Falha de conexão com o serviço de login.';
  return 'Não foi possível entrar na conta.';
}
