require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  initializeApp,
  applicationDefault,
  cert
} = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase, ServerValue } = require('firebase-admin/database');

const app = express();
app.disable('x-powered-by');

const PORT = Number(process.env.PORT) || 3000;
const GAME_NAME = String(process.env.GAME_NAME || 'Day Zombi Survival').trim();
const GAME_VERSION = String(process.env.GAME_VERSION || '0.4').trim();
const GAME_PLATFORM = String(process.env.GAME_PLATFORM || 'Android').trim();
const DOWNLOAD_FILE_NAME = String(process.env.DOWNLOAD_FILE_NAME || 'Day-Zombi-Survival.apk').trim();
const DOWNLOAD_COOLDOWN_MS = Math.max(0, Number(process.env.DOWNLOAD_COOLDOWN_SECONDS || 60) * 1000);
const DOWNLOAD_ROOT = String(process.env.FIREBASE_DOWNLOAD_PATH || 'SiteDownloadDayZombi').replace(/^\/+|\/+$/g, '') || 'SiteDownloadDayZombi';
const REQUIRE_REGISTERED_ACCOUNT = /^(1|true|yes)$/i.test(String(process.env.REQUIRE_REGISTERED_ACCOUNT || 'false'));

const FIREBASE_DATABASE_URL = String(
  process.env.FIREBASE_DATABASE_URL || 'https://dayzozmbi-server-default-rtdb.firebaseio.com'
).trim();

const FIREBASE_WEB_CONFIG = Object.freeze({
  apiKey: String(process.env.FIREBASE_WEB_API_KEY || 'AIzaSyB5A-ySceXCFRQ7iSCnOA68nRJqYpK6DQc').trim(),
  authDomain: String(process.env.FIREBASE_AUTH_DOMAIN || 'dayzozmbi-server.firebaseapp.com').trim(),
  projectId: String(process.env.FIREBASE_WEB_PROJECT_ID || 'dayzozmbi-server').trim(),
  databaseURL: FIREBASE_DATABASE_URL,
  storageBucket: String(process.env.FIREBASE_STORAGE_BUCKET || 'dayzozmbi-server.firebasestorage.app').trim(),
  messagingSenderId: String(process.env.FIREBASE_MESSAGING_SENDER_ID || '221905253103').trim()
});

const GAME_DOWNLOAD_URL = normalizarUrlExterna(process.env.GAME_DOWNLOAD_URL || '');
const GAME_DOWNLOAD_FILE = resolverArquivoDownload(process.env.GAME_DOWNLOAD_FILE || '');
const DOWNLOAD_AVAILABLE = Boolean(GAME_DOWNLOAD_URL || GAME_DOWNLOAD_FILE);

let firebaseDb = null;
let firebaseAuth = null;
let firebaseInitError = null;

try {
  const credential = carregarCredencialFirebase();
  if (credential && FIREBASE_DATABASE_URL) {
    const firebaseApp = initializeApp({
      credential,
      databaseURL: FIREBASE_DATABASE_URL
    });
    firebaseDb = getDatabase(firebaseApp);
    firebaseAuth = getAuth(firebaseApp);
  }
} catch (error) {
  firebaseInitError = error;
  console.error('[Firebase] Falha ao inicializar:', resumirErro(error));
}

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '10m'
}));

const tickets = new Map();

app.get('/api/configuracao-publica', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    firebaseWebConfig: FIREBASE_WEB_CONFIG,
    autenticacaoDisponivel: Boolean(firebaseAuth && FIREBASE_WEB_CONFIG.apiKey),
    downloadDisponivel: DOWNLOAD_AVAILABLE,
    requerContaRegistrada: REQUIRE_REGISTERED_ACCOUNT,
    jogo: {
      nome: GAME_NAME,
      versao: GAME_VERSION,
      plataforma: GAME_PLATFORM,
      arquivo: DOWNLOAD_FILE_NAME
    }
  });
});

app.get('/api/estatisticas', async (_req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!firebaseDb) {
    return res.json({
      totalDownloads: 0,
      usuariosUnicos: 0,
      atualizadoEm: null,
      disponivel: false
    });
  }

  try {
    const snapshot = await firebaseDb.ref(`${DOWNLOAD_ROOT}/Estatisticas`).once('value');
    const data = snapshot.val() || {};
    return res.json({
      totalDownloads: inteiroNaoNegativo(data.totalDownloads),
      usuariosUnicos: inteiroNaoNegativo(data.usuariosUnicos),
      atualizadoEm: numeroOuNull(data.atualizadoEm),
      disponivel: true
    });
  } catch (error) {
    console.error('[Stats] Falha ao consultar:', resumirErro(error));
    return res.status(503).json({ erro: 'Não foi possível carregar o contador agora.' });
  }
});

app.get('/api/minha-conta', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  try {
    const usuario = await obterUsuarioAutenticado(req);
    const conta = await obterContaPorUid(usuario.uid);
    return res.json({
      autenticado: true,
      registrado: Boolean(conta?.Dados?.nick),
      usuario: usuarioPublico(usuario),
      conta: {
        nick: String(conta?.Dados?.nick || ''),
        titulos: inteiroNaoNegativo(conta?.Dados?.Titulos)
      }
    });
  } catch (error) {
    return responderErroAutenticacao(res, error);
  }
});

app.post('/api/iniciar-download', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!DOWNLOAD_AVAILABLE) {
    return res.status(503).json({ erro: 'O arquivo do jogo ainda não foi configurado no servidor.' });
  }

  if (!firebaseDb || !firebaseAuth) {
    return res.status(503).json({ erro: 'O serviço de login/download está temporariamente indisponível.' });
  }

  try {
    const usuario = await obterUsuarioAutenticado(req);
    const conta = await obterContaPorUid(usuario.uid);

    if (REQUIRE_REGISTERED_ACCOUNT && !conta?.Dados?.nick) {
      return res.status(403).json({
        erro: 'Esta conta ainda não possui um perfil Day Zombi registrado.'
      });
    }

    const registro = await registrarDownload(usuario, conta);
    const ticket = criarTicketDownload(usuario.uid);

    return res.json({
      ok: true,
      contabilizado: registro.contabilizado,
      aguardandoCooldown: !registro.contabilizado,
      downloadUrl: `/download/${ticket}`,
      totalDownloads: registro.totalDownloads,
      usuariosUnicos: registro.usuariosUnicos
    });
  } catch (error) {
    if (error?.statusCode) return responderErroAutenticacao(res, error);
    console.error('[Download] Falha ao preparar:', resumirErro(error));
    return res.status(500).json({ erro: 'Não foi possível preparar o download.' });
  }
});

app.get('/download/:ticket', (req, res) => {
  const token = String(req.params.ticket || '');
  const registro = tickets.get(token);

  if (!registro || registro.expiresAt < Date.now()) {
    tickets.delete(token);
    return res.status(401).send('Link de download expirado. Volte ao site e entre na conta novamente.');
  }

  tickets.delete(token);

  if (GAME_DOWNLOAD_FILE) {
    return res.download(GAME_DOWNLOAD_FILE, DOWNLOAD_FILE_NAME, (error) => {
      if (error && !res.headersSent) {
        console.error('[Download] Falha ao enviar arquivo:', resumirErro(error));
        res.status(500).send('Não foi possível enviar o arquivo.');
      }
    });
  }

  return res.redirect(302, GAME_DOWNLOAD_URL);
});

app.get('/api/saude', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    online: true,
    firebase: Boolean(firebaseDb && firebaseAuth),
    download: DOWNLOAD_AVAILABLE,
    erroFirebase: firebaseInitError ? resumirErro(firebaseInitError) : null
  });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ erro: 'Rota não encontrada.' });
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Site de download ${GAME_NAME} na porta ${PORT}`);
  console.log(`Firebase Admin: ${firebaseDb && firebaseAuth ? 'OK' : 'não configurado'}`);
  console.log(`Download: ${DOWNLOAD_AVAILABLE ? 'configurado' : 'não configurado'}`);
  if (GAME_DOWNLOAD_FILE) console.log(`Arquivo local: ${GAME_DOWNLOAD_FILE}`);
  if (GAME_DOWNLOAD_URL) console.log('Download externo: configurado');
});

async function registrarDownload(usuario, conta) {
  const now = Date.now();
  const uid = usuario.uid;
  const userRef = firebaseDb.ref(`${DOWNLOAD_ROOT}/Usuarios/${uid}`);

  const tx = await userRef.transaction((atual) => {
    const estado = atual && typeof atual === 'object' ? { ...atual } : {};
    const ultimo = Number(estado.ultimoDownloadEm) || 0;

    if (ultimo > 0 && now - ultimo < DOWNLOAD_COOLDOWN_MS) {
      return;
    }

    return {
      ...estado,
      uid,
      email: usuario.email || estado.email || '',
      nick: String(conta?.Dados?.nick || estado.nick || ''),
      downloads: inteiroNaoNegativo(estado.downloads) + 1,
      primeiroDownloadEm: Number(estado.primeiroDownloadEm) || now,
      ultimoDownloadEm: now,
      atualizadoEm: now
    };
  }, undefined, false);

  const final = tx.snapshot.val() || {};
  const contabilizado = Boolean(tx.committed && Number(final.ultimoDownloadEm) === now);
  const usuarioNovo = contabilizado && Number(final.primeiroDownloadEm) === now;

  if (contabilizado) {
    const updates = {
      [`${DOWNLOAD_ROOT}/Estatisticas/totalDownloads`]: ServerValue.increment(1),
      [`${DOWNLOAD_ROOT}/Estatisticas/atualizadoEm`]: now
    };

    if (usuarioNovo) {
      updates[`${DOWNLOAD_ROOT}/Estatisticas/usuariosUnicos`] = ServerValue.increment(1);
    }

    await firebaseDb.ref().update(updates);
  }

  const statsSnap = await firebaseDb.ref(`${DOWNLOAD_ROOT}/Estatisticas`).once('value');
  const stats = statsSnap.val() || {};

  return {
    contabilizado,
    totalDownloads: inteiroNaoNegativo(stats.totalDownloads),
    usuariosUnicos: inteiroNaoNegativo(stats.usuariosUnicos)
  };
}

function criarTicketDownload(uid) {
  limparTicketsExpirados();
  const ticket = crypto.randomBytes(32).toString('hex');
  tickets.set(ticket, {
    uid,
    expiresAt: Date.now() + 2 * 60 * 1000
  });
  return ticket;
}

function limparTicketsExpirados() {
  const now = Date.now();
  for (const [token, item] of tickets.entries()) {
    if (!item || item.expiresAt < now) tickets.delete(token);
  }

  if (tickets.size > 5000) {
    const extras = tickets.size - 4000;
    for (const key of tickets.keys()) {
      tickets.delete(key);
      if (tickets.size <= 4000 || extras <= 0) break;
    }
  }
}

async function obterUsuarioAutenticado(req) {
  if (!firebaseAuth) {
    const error = new Error('Firebase Admin/Auth não configurado.');
    error.statusCode = 503;
    throw error;
  }

  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (!token) {
    const error = new Error('Faça login para baixar o jogo.');
    error.statusCode = 401;
    throw error;
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(token, true);
    return {
      uid: decoded.uid,
      email: decoded.email || '',
      nome: decoded.name || '',
      foto: decoded.picture || '',
      provedor: decoded.firebase?.sign_in_provider || '',
      emailVerificado: Boolean(decoded.email_verified)
    };
  } catch (_) {
    const error = new Error('Sua sessão expirou. Entre novamente.');
    error.statusCode = 401;
    throw error;
  }
}

async function obterContaPorUid(uid) {
  if (!firebaseDb || !uid) return null;
  const snapshot = await firebaseDb.ref(`LOGINS_REGISTRADOS/USUARIOS/${uid}`).once('value');
  return snapshot.val();
}

function usuarioPublico(usuario) {
  return {
    uid: usuario.uid,
    email: usuario.email,
    nome: usuario.nome,
    foto: usuario.foto,
    provedor: usuario.provedor,
    emailVerificado: usuario.emailVerificado
  };
}

function responderErroAutenticacao(res, error) {
  return res.status(Number(error?.statusCode) || 401).json({
    autenticado: false,
    erro: error?.message || 'Falha de autenticação.'
  });
}

function carregarCredencialFirebase() {
  const jsonBruto = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();

  if (jsonBruto) {
    let conteudo = jsonBruto;
    if (!conteudo.startsWith('{')) {
      conteudo = Buffer.from(conteudo, 'base64').toString('utf8');
    }
    const serviceAccount = JSON.parse(conteudo);
    serviceAccount.private_key = String(serviceAccount.private_key || '').replace(/\\n/g, '\n');
    return cert(serviceAccount);
  }

  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();

  if (projectId && clientEmail && privateKey) {
    return cert({ projectId, clientEmail, privateKey });
  }

  const filePath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (filePath && fs.existsSync(filePath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    serviceAccount.private_key = String(serviceAccount.private_key || '').replace(/\\n/g, '\n');
    return cert(serviceAccount);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return applicationDefault();
  }

  return null;
}

function resolverArquivoDownload(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return '';
  const absoluto = path.isAbsolute(raw) ? raw : path.resolve(__dirname, raw);
  if (!fs.existsSync(absoluto) || !fs.statSync(absoluto).isFile()) {
    console.warn(`[Download] GAME_DOWNLOAD_FILE não encontrado: ${absoluto}`);
    return '';
  }
  return absoluto;
}

function normalizarUrlExterna(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function inteiroNaoNegativo(valor) {
  return Math.max(0, Math.trunc(Number(valor) || 0));
}

function numeroOuNull(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resumirErro(error) {
  return String(error?.message || error || 'erro desconhecido').slice(0, 300);
}
