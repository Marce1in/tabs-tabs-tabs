# Tabs Tabs Tabs

Extensão de navegador (Chrome) que:

- **Sincroniza suas abas entre navegadores em tempo real** (TabSync) — abriu, fechou ou moveu uma aba em um navegador, ela muda nos outros;
- **Agrupa suas abas com IA** — as abas são organizadas em grupos nomeados por assunto.

O login é feito com GitHub. Toda a sincronização e a chamada de IA acontecem no backend [backs_backs_backs](https://github.com/Marce1in/backs_backs_backs), que **já está hospedado em `https://tabs.marce1in.com.br`** — não é preciso rodar o backend localmente para testar.

Feita com [WXT](https://wxt.dev) + Vue 3 + TypeScript.

## Requisitos

- Node.js 20 ou superior
- pnpm (`npm install -g pnpm`)
- Google Chrome / Chromium

## Instalação

```bash
pnpm install
```

## Configuração

Copie o exemplo de configuração:

```bash
cp .env.example .env
```

Para usar o backend já hospedado, deixe o `.env` assim:

```bash
WXT_BACKEND_HTTP_URL=https://tabs.marce1in.com.br
WXT_SYNC_SOCKET_URL=wss://tabs.marce1in.com.br/socket
```

Para usar um backend local, use os valores padrão do `.env.example` (`http://localhost:4000` e `ws://localhost:4000/socket`) — o passo a passo para subir o backend está no [README do backs_backs_backs](https://github.com/Marce1in/backs_backs_backs).

> Se mudar o `.env` com o `pnpm dev` rodando, reinicie o comando para aplicar.

## Executando

```bash
pnpm dev
```

O WXT abre uma instância limpa do Chrome com a extensão já carregada. Clique no ícone da extensão na barra de ferramentas e entre com **Continuar com GitHub**. A partir do login, as abas desse navegador passam a ser sincronizadas.

## Como testar

### TabSync (sincronização de abas)

A sincronização acontece **entre navegadores diferentes logados na mesma conta GitHub**. Por isso, para testar é necessário ter **duas instâncias do servidor de teste do navegador rodando ao mesmo tempo**. Suba uma de cada vez, nesta ordem:

1. Em um terminal, rode `pnpm dev` — abre uma janela de navegador com a extensão — e faça login com o GitHub nela;
2. Só depois, em **outro terminal**, rode `pnpm dev` de novo — abre uma segunda janela — e faça login com a **mesma conta GitHub**;
3. Abra, feche e mova abas em um navegador e veja as mudanças refletirem no outro.

> Subir um por vez importa: com os dois dev servers iniciando juntos, o popup da extensão pode não renderizar em um dos navegadores (veja "Problemas comuns").

### Agrupamento de abas com IA

Com o login feito, o agrupamento pode ser disparado de duas formas:

- **Manual**: clique no botão **Agrupar abas** no popup da extensão — roda na hora;
- **Automática**: o backend roda o agrupamento sozinho **a cada 5 minutos** para os usuários que estiverem online — basta deixar o navegador aberto e esperar.

Nos dois casos, as abas são reorganizadas em grupos nomeados por assunto em **todos** os navegadores conectados na conta.

## Testes e verificação

```bash
pnpm test      # testes unitários
pnpm compile   # typecheck (TypeScript)
pnpm build     # build de produção (gera .output/chrome-mv3)
```

## Problemas comuns

- **O popup da extensão não renderiza nada em um dos navegadores**: rodando dois `pnpm dev` ao mesmo tempo, pode acontecer de a extensão abrir em branco em uma das janelas enquanto a outra funciona normal. Para contornar: mate os dois dev servers, rode um, faça o login com o GitHub, e **só então** inicie o segundo e faça o login de novo. Mesmo que um dos popups não renderize direito, o TabSync continua funcionando de forma independente depois do login — a sincronização roda no background da extensão, não no popup.
- **Login falha com `unallowed_redirect_uri`**: o backend só aceita login de extensões cujo redirect URI esteja cadastrado na variável `EXTENSION_REDIRECT_URIS` do servidor. O ID desta extensão é fixado pelo campo `key` no `wxt.config.ts` (`liafoemlclglbogonogjffloegilkmgh`), então o login no backend hospedado funciona em qualquer máquina. Se esse erro aparecer usando um backend local, cadastre `https://liafoemlclglbogonogjffloegilkmgh.chromiumapp.org/github` no `EXTENSION_REDIRECT_URIS` dele — veja o [README do backend](https://github.com/Marce1in/backs_backs_backs).
- **As abas não sincronizam**: confirme que as duas instâncias estão logadas na **mesma** conta GitHub e que o `.env` das duas aponta para o mesmo backend.
- **`https://tabs.marce1in.com.br` fora do ar**: o servidor roda no homelab do Marcelo (**aquele** notebook velho pablo...), então provavelmente ele deixou o notebook desligar. Nesse caso, chame o Marcelo no WhatsApp ou rode o backend localmente seguindo o [README do backend](https://github.com/Marce1in/backs_backs_backs).
