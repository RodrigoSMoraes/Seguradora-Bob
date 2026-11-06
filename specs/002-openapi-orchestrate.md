# Especificação — `openapi.yaml` (ferramentas do agente watsonx Orchestrate)

Este documento descreve como criar o arquivo **`openapi.yaml` na raiz do repositório**. O arquivo é importado no **IBM watsonx Orchestrate** para gerar as ferramentas (tools) que o agente usa para abrir, consultar, listar, atualizar e comentar chamados da seguradora.

## Prompt sugerido para o Bob

> Leia `specs/001-openapi-orchestrate.md` e crie o arquivo `openapi.yaml` na raiz do repositório (mesmo nível de `package.json` e `vercel.json`) exatamente conforme a especificação. Não crie o arquivo em outra pasta nem com outro nome. Não inclua rotas, campos ou respostas que não estejam listados. Não é necessário executar testes ou validações.

## 0. Local e nome do arquivo (obrigatório)

| Item | Valor |
|------|-------|
| Caminho | `./openapi.yaml`, na **raiz do repositório** |
| Nome | `openapi.yaml`, sempre minúsculo e com extensão `.yaml` (não `.yml`) |
| Proibido | criar em `backend/`, `backend/openapi/`, `docs/`, `specs/` ou outra subpasta; usar nomes como `orchestrate.yaml` ou `openapi.yml` |

Motivo: o backend lê o arquivo de `path.join(__dirname, '..', '..', 'openapi.yaml')` (`backend/src/app.js`), ou seja, da raiz. Além disso, o `vercel.json` inclui `"includeFiles": "openapi.yaml"` na função serverless. Em qualquer outro local ou nome, `GET /api/openapi.yaml` responde 404 e o Orchestrate não consegue importar as ferramentas.

Se já existir um `openapi.yaml` na raiz, **substitua o conteúdo** desse arquivo em vez de criar outro.

```
Seguradora/
├── openapi.yaml      ◀── criar aqui
├── package.json
├── vercel.json
├── api/
├── backend/
├── frontend/
└── specs/
```

## 1. Regras gerais

1. **Formato:** OpenAPI **3.0.3** em YAML (o Orchestrate não aceita bem 3.1). Indentação de 2 espaços.
2. **Dois ambientes:** todas as rotas ficam sob o prefixo `/api`, então `servers` tem duas entradas, **nesta ordem**:
   1. Produção no Vercel — **`https://seguradora-blush.vercel.app/api`** (primeira da lista, usada por padrão pelo Orchestrate).
   2. Desenvolvimento local — **`http://localhost:3001/api`** (backend rodando na porta 3001).
3. **Escopo:** **somente as 5 rotas do agente** (`/agent/...`). As rotas do frontend (`/tickets`, `/dashboard`, `/auth`) e de infraestrutura (`/health`, `/openapi.yaml`) **não** entram.
4. **Idioma:** `summary` e `description` em **português do Brasil**. São esses textos que o LLM do Orchestrate lê para decidir quando chamar cada ferramenta, então devem dizer **quando usar** a operação.
5. **`operationId` em português, camelCase**: é o nome da ferramenta no Orchestrate.
6. **Reuso:** enums, parâmetros e respostas de erro ficam em `components` e são referenciados com `$ref`.
7. Os nomes de campos JSON (`snake_case`) e os valores de enum devem ser **idênticos** aos do backend (ver `specs/backend/05-rotas-e-contratos-da-api.md`).

## 2. Cabeçalho do documento

```yaml
openapi: 3.0.3

info:
  title: Central de Chamados da Seguradora
  version: "1.1.0"
  description: |
    Ferramentas para o agente do IBM watsonx Orchestrate abrir, consultar,
    listar e atualizar chamados de atendimento da seguradora.

    Autenticação: header `X-API-Key` com o valor da variável de ambiente
    `ORCHESTRATE_API_KEY` configurada no Vercel.

    Ambientes:
    - Produção: https://seguradora-blush.vercel.app
    - Local: http://localhost:3001

servers:
  - url: https://seguradora-blush.vercel.app/api
    description: Produção (Vercel)
  - url: http://localhost:3001/api
    description: Desenvolvimento local

security:
  - ApiKeyAuth: []

tags:
  - name: Chamados
    description: Gerenciamento de chamados de atendimento
```

- `version` deve ser a string `"1.1.0"`, entre aspas, igual à versão retornada por `GET /api/health`.
- `security` é global: todas as operações exigem `ApiKeyAuth`.

## 3. `components`

A ordem no arquivo é `securitySchemes` → `parameters` → `responses` → `schemas`.

### 3.1 `securitySchemes.ApiKeyAuth`

| Chave | Valor |
|-------|-------|
| `type` | `apiKey` |
| `in` | `header` |
| `name` | `X-API-Key` |
| `description` | `Valor da variável ORCHESTRATE_API_KEY do backend` |

### 3.2 `parameters.Protocol`

| Chave | Valor |
|-------|-------|
| `name` | `protocol` |
| `in` | `path` |
| `required` | `true` |
| `description` | `Protocolo do chamado, no formato SEG-AAAAMMDD-NNNNN` |
| `schema` | `type: string`, `example: "SEG-20240101-00001"` |

### 3.3 `responses` (erros reutilizáveis)

Todas têm `content.application/json.schema: $ref '#/components/schemas/ErrorResponse'`.

| Nome | `description` |
|------|---------------|
| `BadRequest` | `Dados inválidos` |
| `Unauthorized` | `API key ausente ou inválida` |
| `NotFound` | `Chamado não encontrado` |

### 3.4 `schemas`

Crie nesta ordem.

#### Enums

| Schema | `enum` (ordem exata) | `description` |
|--------|----------------------|---------------|
| `Status` | `[aberto, em_atendimento, aguardando_cliente, resolvido, encerrado]` | bloco `\|`: `Status do chamado: aberto, em_atendimento, aguardando_cliente` / `(aguardando retorno do cliente), resolvido, encerrado.` |
| `Priority` | `[baixa, media, alta, critica]` | `Prioridade do chamado` |
| `Category` | `[sinistro, apolice, cobranca, cancelamento, duvida, reclamacao, outro]` | bloco `\|`: `Categoria: sinistro (acidente, roubo, dano), apolice (dados, renovação,` / `coberturas), cobranca (fatura, pagamento), cancelamento, duvida,` / `reclamacao, outro.` |

Todos com `type: string`. As descrições que explicam cada valor ajudam o agente a classificar o pedido do cliente.

#### `Ticket` (`type: object`, `description: Chamado de atendimento`)

| Propriedade | Definição |
|-------------|-----------|
| `id` | `string`, `format: uuid` |
| `protocol` | `string`, description `Protocolo do chamado`, example `"SEG-20240101-00001"` |
| `requester_name` | `string`, description `Nome do cliente` |
| `requester_cpf` | `string`, `nullable: true`, description `CPF do cliente (somente dígitos)` |
| `requester_email` | `string`, `nullable: true` |
| `requester_phone` | `string`, `nullable: true` |
| `policy_number` | `string`, `nullable: true`, description `Número da apólice` |
| `title` | `string` |
| `description` | `string` |
| `category` | `$ref Category` |
| `priority` | `$ref Priority` |
| `status` | `$ref Status` |
| `assignee_name` | `string`, `nullable: true`, description `Responsável pelo chamado` |
| `created_at` | `string`, `format: date-time` |
| `updated_at` | `string`, `format: date-time` |
| `resolved_at` | `string`, `format: date-time`, `nullable: true` |
| `closed_at` | `string`, `format: date-time`, `nullable: true` |

> A API também devolve `assignee_id` e `idempotency_key`. Eles ficam **de fora** do schema de propósito, porque o agente não precisa deles. Não marque nenhuma propriedade como `required` nos schemas de resposta.

#### `Interaction` (`type: object`, `description: Comentário registrado no chamado`)

| Propriedade | Definição |
|-------------|-----------|
| `id` | `string`, `format: uuid` |
| `origin` | `string`, `enum: [agente, usuario]`, description `agente = watsonx Orchestrate; usuario = equipe no painel` |
| `author_name` | `string` |
| `content` | `string` |
| `created_at` | `string`, `format: date-time` |

#### `HistoryEntry` (`type: object`, `description: Alteração de campo do chamado`)

| Propriedade | Definição |
|-------------|-----------|
| `field_name` | `string`, description `Campo alterado (status, priority ou assignee)` |
| `old_value` | `string`, `nullable: true` |
| `new_value` | `string`, `nullable: true` |
| `origin` | `string`, `enum: [agente, usuario]` |
| `author_name` | `string` |
| `changed_at` | `string`, `format: date-time` |

#### Envelopes de resposta (todos `type: object`)

| Schema | Propriedades |
|--------|--------------|
| `TicketResponse` | `message: string`; `ticket: $ref Ticket` |
| `TicketDetail` | `ticket: $ref Ticket`; `interactions: array de $ref Interaction`; `history: array de $ref HistoryEntry` |
| `TicketListResponse` | `tickets: array de $ref Ticket`; `total: integer` (description `Total de chamados encontrados`); `page: integer`; `limit: integer`; `pages: integer` |
| `InteractionResponse` | `message: string`; `interaction: $ref Interaction` |
| `ErrorResponse` | `error: string` (description `Mensagem de erro`) |

#### `CreateTicketRequest` (`type: object`, `required: [requester_name, title, description]`)

| Propriedade | Tipo | `description` | `example` |
|-------------|------|---------------|-----------|
| `requester_name` | string | `Nome completo do cliente` | `"Ana Costa"` |
| `requester_cpf` | string | `CPF do cliente, 11 dígitos (opcional)` | `"12345678900"` |
| `requester_email` | string | `E-mail do cliente (opcional)` | `"ana.costa@email.com"` |
| `requester_phone` | string | `Telefone do cliente com DDD (opcional)` | `"11977770001"` |
| `policy_number` | string | `Número da apólice relacionada (opcional)` | `"APL-2024-001234"` |
| `title` | string | `Resumo curto do problema` | `"Sinistro: colisão traseira do veículo"` |
| `description` | string | `Descrição detalhada do que o cliente relatou` | `"O veículo sofreu colisão traseira ontem. Cliente quer saber como acionar o seguro."` |
| `category` | `$ref Category` | — | — |
| `priority` | `$ref Priority` | — | — |
| `author_name` | string | `Nome do assistente que está abrindo o chamado (padrão "Agente WXO")` | — |

> `idempotency_key` existe no backend, mas **não** é exposto: o backend calcula a chave sozinho, e o agente não deve inventar uma.

#### `UpdateTicketRequest` (`type: object`, sem `required`)

| Propriedade | Tipo | `description` | `example` |
|-------------|------|---------------|-----------|
| `status` | `$ref Status` | — | — |
| `priority` | `$ref Priority` | — | — |
| `assignee_name` | string | `Nome do novo responsável pelo chamado` | `"Fernanda Lima"` |
| `author_name` | string | `Nome de quem está fazendo a alteração (padrão "Agente WXO")` | — |

> `assignee_id` **não** é exposto, porque o agente não conhece os UUIDs dos usuários.

#### `AddInteractionRequest` (`type: object`, `required: [content]`)

| Propriedade | Tipo | `description` | `example` |
|-------------|------|---------------|-----------|
| `content` | string | `Texto do comentário` | `"Cliente informou que enviou o boletim de ocorrência por e-mail."` |
| `author_name` | string | `Nome do autor do comentário (padrão "Agente WXO")` | — |

## 4. `paths`

São três paths e cinco operações. Todas usam `tags: [Chamados]`. Respostas de sucesso são `application/json` com o schema indicado.

### 4.1 `/agent/tickets` → `post`

| Chave | Valor |
|-------|-------|
| `operationId` | `criarChamado` |
| `summary` | `Abrir novo chamado` |
| `requestBody` | `required: true`, JSON `$ref CreateTicketRequest` |

`description` (bloco `|`):
```
Abre um novo chamado de atendimento para um cliente da seguradora e
retorna o protocolo gerado (formato SEG-AAAAMMDD-NNNNN), que deve ser
informado ao cliente. Use quando o cliente relatar um problema,
solicitação, dúvida ou reclamação. Se a mesma solicitação for enviada
novamente, o chamado já existente é retornado (sem duplicar).
```

| Resposta | Definição |
|----------|-----------|
| `"201"` | description `Chamado criado`, schema `TicketResponse` |
| `"200"` | description `Chamado idêntico já existia e foi retornado`, schema `TicketResponse` |
| `"400"` | `$ref '#/components/responses/BadRequest'` |
| `"401"` | `$ref '#/components/responses/Unauthorized'` |

### 4.2 `/agent/tickets` → `get`

| Chave | Valor |
|-------|-------|
| `operationId` | `listarChamados` |
| `summary` | `Listar chamados` |

`description` (bloco `|`):
```
Lista chamados, do mais recente para o mais antigo, com filtros
opcionais. Use para encontrar os chamados de um cliente (pelo CPF ou
pelo nome em `search`) ou para listar chamados por status, prioridade
ou categoria.
```

`parameters` (todos `in: query`, `required: false`, nesta ordem):

| `name` | `description` | `schema` |
|--------|---------------|----------|
| `requester_cpf` | `CPF do cliente (11 dígitos, com ou sem pontuação)` | `type: string`, `example: "12345678900"` |
| `status` | `Filtrar por status do chamado` | `$ref Status` |
| `priority` | `Filtrar por prioridade` | `$ref Priority` |
| `category` | `Filtrar por categoria` | `$ref Category` |
| `search` | `Texto livre buscado no nome do cliente, título, protocolo, apólice ou CPF` | `type: string`, `example: "Maria Silva"` |
| `page` | `Página (começa em 1)` | `type: integer`, `default: 1`, `minimum: 1` |
| `limit` | `Itens por página (máximo 100)` | `type: integer`, `default: 20`, `minimum: 1`, `maximum: 100` |

> O `default` de `limit` deve ser **20**, o mesmo valor que o backend usa (`toInt(req.query.limit, 20, 1, 100)`).

| Resposta | Definição |
|----------|-----------|
| `"200"` | description `Lista paginada de chamados`, schema `TicketListResponse` |
| `"400"` | `$ref BadRequest` |
| `"401"` | `$ref Unauthorized` |

### 4.3 `/agent/tickets/{protocol}` → `get`

| Chave | Valor |
|-------|-------|
| `operationId` | `consultarChamado` |
| `summary` | `Consultar chamado por protocolo` |
| `parameters` | `- $ref: '#/components/parameters/Protocol'` |

`description` (bloco `|`):
```
Retorna os dados completos de um chamado a partir do protocolo,
incluindo status atual, responsável, interações (comentários) e o
histórico de alterações. Use quando o cliente perguntar sobre o
andamento de um chamado.
```

| Resposta | Definição |
|----------|-----------|
| `"200"` | description `Dados completos do chamado`, schema `TicketDetail` |
| `"401"` | `$ref Unauthorized` |
| `"404"` | `$ref NotFound` |

### 4.4 `/agent/tickets/{protocol}` → `patch`

| Chave | Valor |
|-------|-------|
| `operationId` | `atualizarChamado` |
| `summary` | `Atualizar status, prioridade ou responsável` |
| `parameters` | `$ref Protocol` |
| `requestBody` | `required: true`, JSON `$ref UpdateTicketRequest` |

`description` (bloco `|`):
```
Altera o status, a prioridade e/ou o responsável de um chamado.
Envie apenas os campos que devem mudar. A alteração fica registrada no
histórico do chamado com origem "agente".
```

| Resposta | Definição |
|----------|-----------|
| `"200"` | description `Chamado atualizado`, schema `TicketResponse` |
| `"400"` | `$ref BadRequest` |
| `"401"` | `$ref Unauthorized` |
| `"404"` | `$ref NotFound` |

### 4.5 `/agent/tickets/{protocol}/interactions` → `post`

| Chave | Valor |
|-------|-------|
| `operationId` | `adicionarInteracao` |
| `summary` | `Adicionar comentário ao chamado` |
| `parameters` | `$ref Protocol` |
| `requestBody` | `required: true`, JSON `$ref AddInteractionRequest` |

`description` (bloco `|`):
```
Registra um comentário ou nota no chamado, por exemplo uma informação
nova passada pelo cliente. Não é permitido em chamados com status
"encerrado".
```

| Resposta | Definição |
|----------|-----------|
| `"201"` | description `Comentário registrado`, schema `InteractionResponse` |
| `"400"` | `$ref BadRequest` |
| `"401"` | `$ref Unauthorized` |
| `"404"` | `$ref NotFound` |
| `"422"` | description `Chamado encerrado não aceita novos comentários`, schema `ErrorResponse` (inline, não é `$ref` de response) |

## 5. Exemplo de referência (trecho)

Use este trecho como modelo de estilo para as demais operações:

```yaml
paths:
  /agent/tickets/{protocol}:
    get:
      operationId: consultarChamado
      tags: [Chamados]
      summary: Consultar chamado por protocolo
      description: |
        Retorna os dados completos de um chamado a partir do protocolo,
        incluindo status atual, responsável, interações (comentários) e o
        histórico de alterações. Use quando o cliente perguntar sobre o
        andamento de um chamado.
      parameters:
        - $ref: '#/components/parameters/Protocol'
      responses:
        "200":
          description: Dados completos do chamado
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TicketDetail'
        "401":
          $ref: '#/components/responses/Unauthorized'
        "404":
          $ref: '#/components/responses/NotFound'
```

Códigos de status sempre entre aspas (`"200"`). Ordem das chaves em cada operação: `operationId`, `tags`, `summary`, `description`, `parameters`, `requestBody`, `responses`.

## 6. Relação com o backend

- O backend publica este arquivo em `GET https://seguradora-blush.vercel.app/api/openapi.yaml` (o `vercel.json` inclui o arquivo na função com `includeFiles: "openapi.yaml"`).
- A rota substitui o placeholder `https://SEU-PROJETO.vercel.app/api` pelo host atual. Como `servers` já traz as URLs de produção e local, **não use o placeholder**: o arquivo é servido sem alterações.
- Localmente, o mesmo arquivo fica disponível em `GET http://localhost:3001/api/openapi.yaml`. O Orchestrate (serviço em nuvem) não alcança `localhost`; a entrada local serve para testes em ferramentas como Postman ou Swagger UI na máquina do desenvolvedor.
