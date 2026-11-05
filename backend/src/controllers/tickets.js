const { getAdminClient } = require('../lib/supabase');
const {
  STATUSES,
  PRIORITIES,
  CATEGORIES,
  checkEnum,
  onlyDigits,
  sanitizeSearch,
  toInt,
} = require('../lib/validation');
const crypto = require('crypto');

const ACTIVE_STATUSES = ['aberto', 'em_atendimento', 'aguardando_cliente'];

/**
 * Gera a chave de idempotência a partir dos campos únicos do chamado.
 */
function buildIdempotencyKey(data) {
  const raw = [
    data.requester_cpf    || '',
    data.requester_email  || '',
    data.requester_phone  || '',
    data.policy_number    || '',
    data.title            || '',
    data.description      || '',
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Gera protocolo único: SEG-YYYYMMDD-NNNNN via função do banco.
 */
async function generateProtocol(db) {
  const { data, error } = await db.rpc('generate_protocol');
  if (error) throw new Error('Falha ao gerar protocolo: ' + error.message);
  return data;
}

/**
 * Busca interações e histórico de um chamado.
 */
async function loadTicketDetail(db, ticket) {
  const [{ data: interactions }, { data: history }] = await Promise.all([
    db
      .from('ticket_interactions')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true }),
    db
      .from('ticket_history')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('changed_at', { ascending: true }),
  ]);

  return {
    ticket,
    interactions: interactions || [],
    history: history || [],
  };
}

/**
 * POST /api/agent/tickets  (agente)
 * POST /api/tickets        (frontend)
 * Cria um novo chamado. Suporta idempotência por hash do conteúdo.
 */
async function createTicket(req, res) {
  const {
    requester_name,
    requester_email,
    requester_phone,
    policy_number,
    title,
    description,
    category = 'outro',
    priority = 'media',
    idempotency_key: clientKey,
  } = req.body;
  const requester_cpf = onlyDigits(req.body.requester_cpf);

  const missing = ['requester_name', 'title', 'description'].filter(f => !req.body[f]);
  if (missing.length) {
    return res.status(400).json({ error: `Campos obrigatórios ausentes: ${missing.join(', ')}` });
  }

  const enumError =
    checkEnum('category', category, CATEGORIES) ||
    checkEnum('priority', priority, PRIORITIES);
  if (enumError) return res.status(400).json({ error: enumError });

  if (requester_cpf && requester_cpf.length !== 11) {
    return res.status(400).json({ error: 'CPF inválido: informe 11 dígitos' });
  }

  const db = getAdminClient();

  // Determina a chave de idempotência
  const idempotencyKey = clientKey || buildIdempotencyKey({ ...req.body, requester_cpf });

  const findExisting = () => db
    .from('tickets')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  const { data: existing } = await findExisting();
  if (existing) {
    return res.status(200).json({
      message: 'Chamado já registrado (idempotência)',
      ticket: existing,
    });
  }

  const protocol = await generateProtocol(db);

  const { data: ticket, error } = await db
    .from('tickets')
    .insert({
      protocol,
      requester_name,
      requester_cpf:   requester_cpf   || null,
      requester_email: requester_email || null,
      requester_phone: requester_phone || null,
      policy_number:   policy_number   || null,
      title,
      description,
      category,
      priority,
      idempotency_key: idempotencyKey,
    })
    .select()
    .single();

  if (error) {
    // Duas requisições idênticas simultâneas: a segunda bate na unique key
    if (error.code === '23505') {
      const { data: raced } = await findExisting();
      if (raced) {
        return res.status(200).json({ message: 'Chamado já registrado (idempotência)', ticket: raced });
      }
    }
    console.error('Erro ao criar ticket:', error);
    return res.status(500).json({ error: 'Erro interno ao criar chamado' });
  }

  const { actor } = req;
  await db.from('ticket_interactions').insert({
    ticket_id: ticket.id,
    origin: actor.origin,
    author_name: actor.name,
    author_id: actor.id,
    content: actor.origin === 'agente'
      ? `Chamado aberto automaticamente pelo agente de atendimento. Protocolo: ${protocol}`
      : `Chamado aberto por ${actor.name}. Protocolo: ${protocol}`,
  });

  return res.status(201).json({
    message: 'Chamado criado com sucesso',
    ticket,
  });
}

/**
 * GET /api/tickets
 * Lista chamados com filtros opcionais.
 */


/**
 * GET /api/tickets/:protocol
 * Busca um chamado pelo protocolo.
 */
async function getTicketByProtocol(req, res) {
  const protocol = req.params.protocol.trim().toUpperCase();
  const db = getAdminClient();

  const { data: ticket } = await db
    .from('tickets')
    .select('*')
    .eq('protocol', protocol)
    .maybeSingle();

  if (!ticket) {
    return res.status(404).json({ error: `Chamado com protocolo ${protocol} não encontrado` });
  }

  return res.json(await loadTicketDetail(db, ticket));
}

/**
 * GET /api/tickets/id/:id
 * Busca um chamado pelo ID interno (UUID).
 */
async function getTicketById(req, res) {
  const { id } = req.params;
  const db = getAdminClient();

  const { data: ticket } = await db
    .from('tickets')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!ticket) {
    return res.status(404).json({ error: 'Chamado não encontrado' });
  }

  return res.json(await loadTicketDetail(db, ticket));
}

/**
 * PATCH /api/tickets/:protocol
 * Atualiza status, prioridade ou responsável de um chamado.
 * A origem (agente/usuario) vem da autenticação, não do corpo.
 */
async function updateTicket(req, res) {
  const protocol = req.params.protocol.trim().toUpperCase();
  const { status, priority, assignee_id, assignee_name } = req.body;

  if (status === undefined && priority === undefined &&
      assignee_id === undefined && assignee_name === undefined) {
    return res.status(400).json({
      error: 'Informe ao menos um campo para atualizar: status, priority ou assignee_name',
    });
  }

  const enumError =
    checkEnum('status', status, STATUSES) ||
    checkEnum('priority', priority, PRIORITIES);
  if (enumError) return res.status(400).json({ error: enumError });

  const db = getAdminClient();

  const { data: ticket } = await db
    .from('tickets')
    .select('id, status, priority, assignee_name')
    .eq('protocol', protocol)
    .maybeSingle();

  if (!ticket) {
    return res.status(404).json({ error: `Chamado ${protocol} não encontrado` });
  }

  const updates = {};
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  if (assignee_name !== undefined) updates.assignee_name = assignee_name || null;
  if (assignee_id !== undefined) updates.assignee_id = assignee_id || null;

  // Timestamps especiais
  if (status && status !== ticket.status) {
    const now = new Date().toISOString();
    if (status === 'resolvido') updates.resolved_at = now;
    if (status === 'encerrado') updates.closed_at = now;
    if (ACTIVE_STATUSES.includes(status)) {
      // Reabertura
      updates.resolved_at = null;
      updates.closed_at = null;
    }
  }

  const { data: updated, error: updateError } = await db
    .from('tickets')
    .update(updates)
    .eq('id', ticket.id)
    .select()
    .single();

  if (updateError) {
    console.error('Erro ao atualizar ticket:', updateError);
    return res.status(500).json({ error: 'Erro interno ao atualizar chamado' });
  }

  // Registra histórico (o banco não tem trigger para isso — ver migration 001)
  const { actor } = req;
  const changes = [
    ['status', ticket.status, updates.status],
    ['priority', ticket.priority, updates.priority],
    ['assignee', ticket.assignee_name, updates.assignee_name],
  ].filter(([, oldValue, newValue]) => newValue !== undefined && newValue !== oldValue);

  if (changes.length > 0) {
    await db.from('ticket_history').insert(changes.map(([field_name, old_value, new_value]) => ({
      ticket_id: ticket.id,
      origin: actor.origin,
      author_name: actor.name,
      author_id: actor.id,
      field_name,
      old_value,
      new_value,
    })));
  }

  return res.json({ message: 'Chamado atualizado com sucesso', ticket: updated });
}

/**
 * POST /api/tickets/:protocol/interactions
 * Adiciona uma interação a um chamado.
 */
async function addInteraction(req, res) {
  const protocol = req.params.protocol.trim().toUpperCase();
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!content) {
    return res.status(400).json({ error: 'O campo content é obrigatório' });
  }

  const db = getAdminClient();

  const { data: ticket } = await db
    .from('tickets')
    .select('id, status')
    .eq('protocol', protocol)
    .maybeSingle();

  if (!ticket) {
    return res.status(404).json({ error: `Chamado ${protocol} não encontrado` });
  }

  if (ticket.status === 'encerrado') {
    return res.status(422).json({ error: 'Não é possível adicionar interações a chamados encerrados' });
  }

  const { actor } = req;
  const { data: interaction, error } = await db
    .from('ticket_interactions')
    .insert({
      ticket_id: ticket.id,
      origin: actor.origin,
      author_name: actor.name,
      author_id: actor.id,
      content,
    })
    .select()
    .single();

  if (error) {
    console.error('Erro ao adicionar interação:', error);
    return res.status(500).json({ error: 'Erro interno ao registrar interação' });
  }

  return res.status(201).json({ message: 'Interação registrada com sucesso', interaction });
}

module.exports = {
  createTicket,
  getTicketByProtocol,
  getTicketById,
  updateTicket,
  addInteraction,
};
