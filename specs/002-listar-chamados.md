# Especificação — Rota `GET /tickets` e função `listTickets`

Esta spec descreve como reimplementar a **listagem paginada de chamados** do backend: a função `listTickets` em `backend/src/controllers/tickets.js` e o registro das rotas que a usam em `backend/src/routes/index.js`.

## Prompt sugerido para o Bob

> Leia `specs/002-listar-chamados.md` e implemente a função `listTickets` e o registro das rotas exatamente como especificado. Altere **somente** os trechos indicados na seção 2. Não modifique as outras funções, os helpers de `lib/validation.js` nem as outras rotas. Ao final, execute os testes da seção 7 e me mostre o resultado.

## 1. Contexto

- A mesma função atende **dois clientes**, com autenticações diferentes:
  - `GET /api/tickets`: tela "Chamados" do frontend, com `Authorization: Bearer <JWT do Supabase>`.
  - `GET /api/agent/tickets`: ferramenta `listarChamados` do watsonx Orchestrate, com `X-API-Key`.
- A autenticação é feita pelos middlewares que já existem (`requireAuth` e `requireOrchestrateKey`). A função **não** verifica autenticação nem usa `req.actor`, porque só faz leitura.
- Os dados vêm da tabela `public.tickets` do Supabase. As colunas usadas estão em `specs/backend/02-banco-de-dados.md`.

## 2. Escopo da alteração

| Arquivo | O que fazer |
|---------|-------------|
| `backend/src/controllers/tickets.js` | Criar a função `async function listTickets(req, res)` **entre** `createTicket` e `getTicketByProtocol`, e incluir `listTickets` no `module.exports`, logo depois de `createTicket` |
| `backend/src/routes/index.js` | Registrar as duas rotas da seção 4, nas posições indicadas |

**Não** criar arquivos novos, dependências novas, camadas de service/repository ou helpers novos.

## 3. Dependências que já existem (apenas usar)

No topo de `controllers/tickets.js` já estão importados:

```js
const { getAdminClient } = require('../lib/supabase');
const {
  STATUSES, PRIORITIES, CATEGORIES,
  checkEnum, onlyDigits, sanitizeSearch, toInt,
} = require('../lib/validation');
```

| Helper | Comportamento |
|--------|---------------|
| `getAdminClient()` | Client Supabase com service_role, que ignora o RLS |
| `checkEnum(field, value, allowed)` | Retorna `null` se `value` for vazio ou válido; senão retorna a mensagem `Valor inválido para ${field}: "${value}". Use um de: ...` |
| `onlyDigits(value)` | Remove o que não é dígito se `value` for string; senão devolve `value` sem mudança |
| `sanitizeSearch(value)` | Troca `, ( ) % * \` por espaço, faz `trim` e corta em 100 caracteres |
| `toInt(value, fallback, min, max)` | Usa `parseInt` na base 10; se der `NaN`, devolve `fallback`; senão limita o valor ao intervalo `[min, max]` |

Se algum desses imports tiver sido apagado junto com a função, restaure-o exatamente como acima.

## 4. Rotas (`backend/src/routes/index.js`)

Os handlers são sempre envolvidos pelo `wrap(...)` que já existe no arquivo, porque o Express 4 não captura erros de funções async.

| Método | Caminho (o router é montado em `/api`) | Middleware | Posição no arquivo |
|--------|----------------------------------------|-----------|--------------------|
| GET | `/agent/tickets` | `requireOrchestrateKey` | logo após `router.post('/agent/tickets', ...)` |
| GET | `/tickets` | `requireAuth` | logo após `router.post('/tickets', ...)` e **antes** de `/tickets/id/:id` e `/tickets/:protocol` |

```js
router.get('/agent/tickets', requireOrchestrateKey, wrap(ticketController.listTickets));
// ...
router.get('/tickets', requireAuth, wrap(ticketController.listTickets));
```

## 5. Contrato HTTP

### 5.1 Query params (todos opcionais)

| Param | Tipo | Regra | Filtro aplicado |
|-------|------|-------|-----------------|
| `status` | enum `STATUSES` | valida com `checkEnum` | `eq('status', status)` |
| `priority` | enum `PRIORITIES` | valida com `checkEnum` | `eq('priority', priority)` |
| `category` | enum `CATEGORIES` | valida com `checkEnum` | `eq('category', category)` |
| `assignee_id` | uuid | sem validação | `eq('assignee_id', assignee_id)` |
| `requester_cpf` | string | normalizado com `onlyDigits` (aceita `123.456.789-09`) | `eq('requester_cpf', cpf)` |
| `search` | string | `sanitizeSearch`; é ignorado se ficar vazio | `ilike` parcial com OR em 5 colunas (ver 6.7) |
| `page` | inteiro | `toInt(page, 1, 1, 10000)` | paginação |
| `limit` | inteiro | `toInt(limit, 20, 1, 100)` | paginação |

Valores enum: `status` = `aberto, em_atendimento, aguardando_cliente, resolvido, encerrado`; `priority` = `baixa, media, alta, critica`; `category` = `sinistro, apolice, cobranca, cancelamento, duvida, reclamacao, outro`.

Valores inválidos de `page` e `limit` **não** geram erro: `abc` vira o padrão, `0` vira 1 e `500` vira 100.

### 5.2 Resposta 200

```json
{
  "tickets": [ { "id": "...", "protocol": "SEG-20261105-00009", "requester_name": "...", "...": "todas as colunas de tickets" } ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "pages": 3
}
```

| Campo | Valor |
|-------|-------|
| `tickets` | Linhas da página atual (`select *`), ordenadas por `created_at` decrescente; `[]` se não houver nenhuma |
| `total` | Total de registros que atendem aos filtros, considerando todas as páginas (`count \|\| 0`) |
| `page` | Página efetiva, já normalizada |
| `limit` | Limite efetivo, já normalizado |
| `pages` | `Math.ceil(total / limit)`; dá `0` quando `total` é 0 |

### 5.3 Erros

| Status | Corpo | Quando |
|--------|-------|--------|
| 400 | `{ "error": "Valor inválido para status: \"fechado\". Use um de: aberto, em_atendimento, aguardando_cliente, resolvido, encerrado" }` | enum inválido; a validação segue a ordem **status → priority → category** e retorna só o primeiro erro |
| 401 | gerado pelo middleware | sem autenticação |
| 500 | `{ "error": "Erro interno ao listar chamados" }` | a consulta ao Supabase retornou `error` |

## 6. Algoritmo de `listTickets(req, res)`

JSDoc acima da função:

```js
/**
 * GET /api/tickets
 * Lista chamados com filtros opcionais.
 */
```

1. Ler os parâmetros:
   - `const { status, priority, category, assignee_id, search } = req.query;`
   - `const cpf = onlyDigits(req.query.requester_cpf);`
   - `const page = toInt(req.query.page, 1, 1, 10000);`
   - `const limit = toInt(req.query.limit, 20, 1, 100);`
2. Validar os enums encadeando com `||`, na ordem status, priority, category:
   `checkEnum('status', status, STATUSES) || checkEnum('priority', priority, PRIORITIES) || checkEnum('category', category, CATEGORIES)`.
   Se houver mensagem: `return res.status(400).json({ error: enumError })`.
3. `const db = getAdminClient();` e `const offset = (page - 1) * limit;`
4. Montar a query base:
   ```js
   let query = db
     .from('tickets')
     .select('*', { count: 'exact' })
     .order('created_at', { ascending: false })
     .range(offset, offset + limit - 1);
   ```
   `count: 'exact'` faz o Supabase devolver o total sem baixar todas as linhas. `range` usa índices inclusivos.
5. Aplicar os filtros de igualdade apenas quando o valor for truthy, nesta ordem: `status`, `priority`, `category`, `assignee_id`, `requester_cpf` (com `cpf`). Exemplo: `if (status) query = query.eq('status', status);`
6. Calcular `const term = search ? sanitizeSearch(search) : '';`
7. Se `term` não estiver vazio, aplicar a busca textual:
   ```js
   query = query.or(
     ['requester_name', 'title', 'protocol', 'policy_number', 'requester_cpf']
       .map(col => `${col}.ilike.%${term}%`)
       .join(',')
   );
   ```
   O `sanitizeSearch` é obrigatório: sem ele, um `,` ou `)` digitado pelo usuário quebraria (ou injetaria condições) na sintaxe do filtro `.or()` do PostgREST.
8. Executar: `const { data, error, count } = await query;`
9. Se houver `error`: `console.error('Erro ao listar tickets:', error);` e `return res.status(500).json({ error: 'Erro interno ao listar chamados' });`
10. Responder:
    ```js
    return res.json({
      tickets: data,
      total: count || 0,
      page,
      limit,
      pages: Math.ceil((count || 0) / limit),
    });
    ```

Estilo: função `async`, sem `try/catch` (exceções sobem pelo `wrap` até o error handler global), indentação de 2 espaços, aspas simples e ponto e vírgula, como no resto do arquivo.

## 7. Critérios de aceite

Variáveis (bash):

```bash
API=http://localhost:3001/api        # ou https://seguradora-blush.vercel.app/api
KEY=<ORCHESTRATE_API_KEY>
TOKEN=<access_token obtido em POST /api/auth/login>
```

| # | Comando | Esperado |
|---|---------|----------|
| 1 | `curl -s "$API/tickets" -H "Authorization: Bearer $TOKEN"` | 200 com `page: 1`, `limit: 20` e chamados do mais novo para o mais antigo |
| 2 | `curl -s "$API/agent/tickets?limit=1" -H "X-API-Key: $KEY"` | 200, `tickets` com 1 item e `pages` igual a `total` |
| 3 | `curl -s "$API/tickets?status=aberto" -H "Authorization: Bearer $TOKEN"` | Todos os itens com `status: "aberto"` |
| 4 | `curl -s "$API/tickets?status=fechado" -H "Authorization: Bearer $TOKEN"` | 400 `Valor inválido para status: "fechado". Use um de: ...` |
| 5 | `curl -s "$API/tickets?priority=x&category=y" -H "Authorization: Bearer $TOKEN"` | 400 que menciona **priority** (o primeiro inválido) |
| 6 | `curl -s "$API/agent/tickets?requester_cpf=123.456.789-09" -H "X-API-Key: $KEY"` | Mesmo resultado de `requester_cpf=12345678909` |
| 7 | `curl -s "$API/tickets?search=maria" -H "Authorization: Bearer $TOKEN"` | Itens com "maria" (sem diferenciar maiúsculas) no nome, título, protocolo, apólice ou CPF |
| 8 | `curl -s "$API/tickets?search=a,b)" -H "Authorization: Bearer $TOKEN"` | 200 (não pode dar 500) |
| 9 | `curl -s "$API/tickets?page=abc&limit=500" -H "Authorization: Bearer $TOKEN"` | 200 com `page: 1` e `limit: 100` |
| 10 | `curl -s "$API/tickets?search=zzzzzz" -H "Authorization: Bearer $TOKEN"` | `{"tickets":[],"total":0,"page":1,"limit":20,"pages":0}` |
| 11 | `curl -s "$API/tickets"` (sem token) | 401 `Token de autenticação ausente ou inválido` |
| 12 | `curl -s "$API/agent/tickets"` (sem chave) | 401 `API key inválida ou ausente` |
| 13 | No frontend (`npm run dev:frontend`), abrir a tela **Chamados** | A lista carrega, os filtros e a busca funcionam e a paginação ("Página X de Y") navega. O frontend envia `limit=15`. |
| 14 | `curl -s "$API/tickets/SEG-20240101-00001" -H "Authorization: Bearer $TOKEN"` | Continua funcionando: a rota de detalhe não foi afetada |
