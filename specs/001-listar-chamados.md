# Especificação — Rotas `GET /tickets` e `GET /agent/tickets` e função `listTickets`

Esta spec descreve como reimplementar a **listagem paginada de chamados** do backend. São **três entregas obrigatórias**:

| # | Entrega | Arquivo |
|---|---------|---------|
| 1 | Função `listTickets` + exportação | `backend/src/controllers/tickets.js` |
| 2 | Rota **`GET /api/tickets`** (frontend, JWT) | `backend/src/routes/index.js` |
| 3 | Rota **`GET /api/agent/tickets`** (agente Orchestrate, X-API-Key) | `backend/src/routes/index.js` |

> ⚠️ **As duas rotas são obrigatórias.** A tarefa só está concluída quando `GET /api/tickets` **e** `GET /api/agent/tickets` estão registradas em `routes/index.js`. Entregar uma só rota é implementação **incompleta**: o frontend ou o agente do watsonx Orchestrate (ferramenta `listarChamados`) ficaria sem listagem.

## Prompt sugerido para o Bob

> Leia `specs/002-listar-chamados.md` e faça as 3 entregas da tabela inicial: a função `listTickets` (exportada) e **as duas rotas**, `GET /tickets` (com `requireAuth`) e `GET /agent/tickets` (com `requireOrchestrateKey`). Antes de editar, verifique o estado atual dos arquivos conforme a seção 2.1, para não duplicar nada. Altere **somente** os trechos indicados. Não modifique as outras funções, os helpers de `lib/validation.js` nem as outras rotas. Não é necessário executar testes: ao final, apenas confira o checklist da seção 7.

## 1. Contexto

- A mesma função atende **dois clientes**, com autenticações diferentes:
  - `GET /api/tickets`: tela "Chamados" do frontend, com `Authorization: Bearer <JWT do Supabase>`.
  - `GET /api/agent/tickets`: ferramenta `listarChamados` do watsonx Orchestrate, com `X-API-Key`.
- A autenticação é feita pelos middlewares que já existem (`requireAuth` e `requireOrchestrateKey`). A função **não** verifica autenticação nem usa `req.actor`, porque só faz leitura.
- Os dados vêm da tabela `public.tickets` do Supabase. As colunas usadas estão em `specs/backend/02-banco-de-dados.md`.

## 2. Escopo da alteração

| Arquivo | O que fazer |
|---------|-------------|
| `backend/src/controllers/tickets.js` | Criar a função `async function listTickets(req, res)` **entre** `createTicket` e `getTicketByProtocol`. Garantir que `listTickets` esteja no `module.exports`, logo depois de `createTicket` |
| `backend/src/routes/index.js` | Garantir que **as duas** rotas da seção 4 estejam registradas, cada uma uma única vez, nas posições indicadas |

**Não** criar arquivos novos, dependências novas, camadas de service/repository ou helpers novos.

### 2.1 Verificação do estado atual (fazer antes de editar)

O código pode ter sido apagado só em parte. Verifique cada item e aja conforme a tabela, para **nunca duplicar** uma linha:

| Verificação | Se existir | Se não existir |
|-------------|------------|----------------|
| `async function listTickets` em `controllers/tickets.js` | Substituir o corpo pelo da seção 6 | Criar a função na posição indicada |
| `listTickets,` dentro do `module.exports` de `controllers/tickets.js` | Manter | Adicionar logo após `createTicket,` |
| `router.get('/tickets', ...)` em `routes/index.js` | Conferir se é igual à seção 4 e corrigir se preciso | Adicionar |
| `router.get('/agent/tickets', ...)` em `routes/index.js` | Conferir se é igual à seção 4 e corrigir se preciso | Adicionar |

> Se o nome `listTickets` estiver no `module.exports` sem a função existir, o backend nem sobe: `ReferenceError: listTickets is not defined`. Se uma rota usar `ticketController.listTickets` sem a função exportada, o servidor sobe, mas a rota responde 500 `Erro interno do servidor` e o log mostra `TypeError: fn is not a function` (vindo do `wrap`). Os dois erros desaparecem quando as 3 entregas estão completas.

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

São **duas rotas distintas, as duas obrigatórias**, apontando para o **mesmo** handler `ticketController.listTickets`. O que muda entre elas é só o middleware de autenticação. Os handlers são sempre envolvidos pelo `wrap(...)` que já existe no arquivo, porque o Express 4 não captura erros de funções async.

| # | Método | Caminho no router | URL final | Middleware | Cliente | Posição no arquivo |
|---|--------|-------------------|-----------|-----------|---------|--------------------|
| 4.1 | GET | `/agent/tickets` | `/api/agent/tickets` | `requireOrchestrateKey` | Agente watsonx Orchestrate (`listarChamados` no `openapi.yaml`) | bloco "Rotas do Orchestrate", logo após `router.post('/agent/tickets', ...)` e antes de `router.get('/agent/tickets/:protocol', ...)` |
| 4.2 | GET | `/tickets` | `/api/tickets` | `requireAuth` | Frontend (tela Chamados) | bloco "Rotas do Frontend → // Chamados", logo após `router.post('/tickets', ...)` e **antes** de `/tickets/id/:id` e `/tickets/:protocol` |

### 4.1 Rota do agente

```js
router.get('/agent/tickets', requireOrchestrateKey, wrap(ticketController.listTickets));
```

### 4.2 Rota do frontend

```js
router.get('/tickets', requireAuth, wrap(ticketController.listTickets));
```

### 4.3 Como os blocos devem ficar

```js
router.post('/agent/tickets', requireOrchestrateKey, wrap(ticketController.createTicket));
router.get('/agent/tickets', requireOrchestrateKey, wrap(ticketController.listTickets));          // ◀ 4.1
router.get('/agent/tickets/:protocol', requireOrchestrateKey, wrap(ticketController.getTicketByProtocol));
router.patch('/agent/tickets/:protocol', requireOrchestrateKey, wrap(ticketController.updateTicket));
router.post('/agent/tickets/:protocol/interactions', requireOrchestrateKey, wrap(ticketController.addInteraction));

// ...

// Chamados
router.post('/tickets', requireAuth, wrap(ticketController.createTicket));
router.get('/tickets', requireAuth, wrap(ticketController.listTickets));                          // ◀ 4.2
router.get('/tickets/id/:id', requireAuth, wrap(ticketController.getTicketById));
router.get('/tickets/:protocol', requireAuth, wrap(ticketController.getTicketByProtocol));
router.patch('/tickets/:protocol', requireAuth, wrap(ticketController.updateTicket));
router.post('/tickets/:protocol/interactions', requireAuth, wrap(ticketController.addInteraction));
```

(Os comentários `// ◀` servem só para esta spec. Não os coloque no código.)

**Erros comuns a evitar:**
- Registrar só uma das rotas.
- Trocar os middlewares. A rota `/agent/...` usa **`requireOrchestrateKey`**; a `/tickets` usa **`requireAuth`**.
- Criar uma função separada para o agente (ex.: `listTicketsAgent`). As duas rotas usam o **mesmo** `listTickets`.
- Esquecer o `wrap(...)`.

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

## 7. Checklist de conclusão (verificação no código, sem executar testes)

- [ ] `controllers/tickets.js` tem **uma** `async function listTickets(req, res)`, entre `createTicket` e `getTicketByProtocol`.
- [ ] `listTickets` aparece no `module.exports`.
- [ ] `routes/index.js` tem **exatamente uma** linha `router.get('/agent/tickets', requireOrchestrateKey, wrap(ticketController.listTickets));`
- [ ] `routes/index.js` tem **exatamente uma** linha `router.get('/tickets', requireAuth, wrap(ticketController.listTickets));`
