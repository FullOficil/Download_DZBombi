# Day Zombi Survival — Site de Download Oficial

Site separado para disponibilizar o download do jogo com:

- login Google via Firebase Authentication;
- reutilização do mesmo Firebase do sistema atual do Day Zombi;
- botão de download bloqueado até o usuário entrar na conta;
- contador público de downloads;
- contador de contas únicas que já baixaram;
- registro por usuário em Firebase Realtime Database;
- proteção contra vários cliques seguidos inflarem o contador;
- ticket temporário e de uso único para a rota de download;
- opção de link externo ou arquivo hospedado no próprio servidor;
- layout responsivo para PC e celular.

## 1. Instalar

```bash
npm install
```

Depois copie `.env.example` para `.env` e preencha as variáveis.

## 2. Configurar o arquivo do jogo

Você pode usar uma destas formas:

### Link externo

```env
GAME_DOWNLOAD_URL=https://seuservidor.com/Day-Zombi-Survival.apk
```

O jogador precisa autenticar no site primeiro. Depois o servidor cria um ticket temporário e redireciona para o link.

> Atenção: se `GAME_DOWNLOAD_URL` for um endereço público, depois que alguém chegar ao endereço final ele poderá copiar esse endereço. Para bloquear completamente o arquivo por conta, use arquivo local no servidor ou um serviço de armazenamento privado com URLs assinadas.

### Arquivo hospedado junto do site

Coloque o APK, por exemplo, em:

`downloads/Day-Zombi-Survival.apk`

E use:

```env
GAME_DOWNLOAD_FILE=downloads/Day-Zombi-Survival.apk
DOWNLOAD_FILE_NAME=Day-Zombi-Survival.apk
```

Se `GAME_DOWNLOAD_FILE` existir, ele tem prioridade sobre `GAME_DOWNLOAD_URL`.

## 3. Firebase

O front-end já segue a mesma configuração pública encontrada no sistema atual do Day Zombi. O backend precisa das credenciais Firebase Admin, assim como sua loja já precisa.

No Render, a forma mais simples é copiar as mesmas variáveis Firebase usadas no backend atual, especialmente:

```env
FIREBASE_DATABASE_URL=...
FIREBASE_SERVICE_ACCOUNT_JSON=...
```

Também confira no Firebase Console > Authentication > Settings > Authorized domains se o domínio do novo site está autorizado.

## 4. Onde o contador fica salvo

Por padrão:

```text
SiteDownloadDayZombi/
  Estatisticas/
    totalDownloads
    usuariosUnicos
    atualizadoEm
  Usuarios/
    <firebaseUid>/
      email
      nick
      downloads
      primeiroDownloadEm
      ultimoDownloadEm
```

Você pode trocar a raiz com:

```env
FIREBASE_DOWNLOAD_PATH=SiteDownloadDayZombi
```

## 5. Exigir conta já cadastrada no jogo

Por padrão, basta estar autenticado no Firebase. Se quiser obrigar que exista também um Nick em `LOGINS_REGISTRADOS/USUARIOS/<uid>/Dados/nick`, altere:

```env
REQUIRE_REGISTERED_ACCOUNT=true
```

## 6. Rodar

```bash
npm start
```

No Render, use:

- Build Command: `npm install`
- Start Command: `npm start`
- Node: 22

## Observação sobre o contador

Por padrão, o mesmo usuário só aumenta o contador uma vez a cada 60 segundos. Ele ainda pode baixar novamente durante esse período, mas o segundo clique não aumenta o número exibido.

Altere com:

```env
DOWNLOAD_COOLDOWN_SECONDS=60
```

## Teste local já configurado

Esta cópia está preparada para teste local com `http://localhost:3000`.

- Use `INICIAR_SITE.bat` para iniciar com dois cliques no Windows.
- O arquivo `.env` local já contém a configuração necessária para este teste.
- `downloads/Day-Zombi-Survival-Teste.apk` é apenas um arquivo fictício para confirmar que o fluxo de download funciona; não é um APK instalável.
- O arquivo `.env` está no `.gitignore`. Não o publique nem envie ao GitHub.
- Se o Firebase retornar `auth/unauthorized-domain`, adicione `localhost` em **Authentication > Settings > Authorized domains** no Firebase Console.
