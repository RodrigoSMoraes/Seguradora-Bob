const express = require('express');
const { requireAuth, requireOrchestrateKey } = require('../middleware/auth');
const ticketController = require('../controllers/tickets');
const dashboardController = require('../controllers/dashboard');
const authController = require('../controllers/auth');

const router = express.Router();

// Express 4 não captura rejeições de handlers async — sem isso um erro
// deixaria a requisição pendurada até o timeout da função no Vercel.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Rotas do Orchestrate (autenticação via X-API-Key)
 * Estas rotas são chamadas pelo agente do watsonx Orchestrate.
 */
router.post('/agent/tickets', requireOrchestrateKey, wrap(ticketController.createTicket));
router.get('/agent/tickets/:protocol', requireOrchestrateKey, wrap(ticketController.getTicketByProtocol));
router.patch('/agent/tickets/:protocol', requireOrchestrateKey, wrap(ticketController.updateTicket));
router.post('/agent/tickets/:protocol/interactions', requireOrchestrateKey, wrap(ticketController.addInteraction));

/**
 * Rotas do Frontend (autenticação via JWT do Supabase Auth)
 */

// Dashboard
router.get('/dashboard/stats', requireAuth, wrap(dashboardController.getStats));

// Chamados
router.post('/tickets', requireAuth, wrap(ticketController.createTicket));
router.get('/tickets/id/:id', requireAuth, wrap(ticketController.getTicketById));
router.get('/tickets/:protocol', requireAuth, wrap(ticketController.getTicketByProtocol));
router.patch('/tickets/:protocol', requireAuth, wrap(ticketController.updateTicket));
router.post('/tickets/:protocol/interactions', requireAuth, wrap(ticketController.addInteraction));

// Auth
router.post('/auth/login', wrap(authController.login));
router.post('/auth/logout', wrap(authController.logout));
router.get('/auth/me', requireAuth, wrap(authController.me));

module.exports = router;
