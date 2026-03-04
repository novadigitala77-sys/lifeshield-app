// src/api/routes/leads.ts
// POST /api/leads — Crear nuevo lead desde formulario o chatbot
// GET  /api/leads — Listar leads del agente (autenticado)

import type { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'
import { supabaseAdmin } from '../../lib/supabase'
import { calculateScore } from '../../lib/scoring'
import { sendTemplatedMessage } from '../../lib/twilio'
import type { LeadScore, BudgetRange, UrgencyLevel, GoalType, ContactPreference } from '../../lib/supabase'

// ── VALIDACIÓN DEL BODY ───────────────────────────────────────
const CreateLeadSchema = z.object({
  first_name: z.string().min(1, 'Nombre requerido'),
  last_name: z.string().min(1, 'Apellido requerido'),
  phone: z.string().min(7, 'Teléfono inválido'),
  email: z.string().email().optional().or(z.literal('')),
  state: z.string().optional(),
  age: z.number().int().min(18).max(85).optional(),
  smoker: z.boolean().default(false),
  goal: z.enum(['family', 'mortgage', 'business', 'final_expenses']).optional(),
  budget: z.enum(['25_50', '50_100', '100_plus']).default('50_100'),
  contact_preference: z.enum(['call', 'zoom', 'whatsapp', 'in_person']).default('call'),
  urgency: z.enum(['today', 'this_week', 'info_only']).default('this_week'),
  source: z.string().optional(),
  utm_source: z.string().optional(),
  utm_campaign: z.string().optional(),
  agent_id: z.string().uuid().optional(), // Si no se pasa, se usa el agente por defecto
})

// ── HANDLER PRINCIPAL ─────────────────────────────────────────
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') return createLead(req, res)
  if (req.method === 'GET') return getLeads(req, res)
  return res.status(405).json({ error: 'Método no permitido' })
}

// ── CREAR LEAD ────────────────────────────────────────────────
async function createLead(req: NextApiRequest, res: NextApiResponse) {
  // 1. Validar datos
  const parse = CreateLeadSchema.safeParse(req.body)
  if (!parse.success) {
    return res.status(400).json({
      error: 'Datos inválidos',
      details: parse.error.flatten().fieldErrors,
    })
  }
  const data = parse.data

  // 2. Obtener agente (del body o el único agente registrado)
  let agentId = data.agent_id
  if (!agentId) {
    const { data: agent } = await supabaseAdmin.from('agents').select('id').limit(1).single()
    agentId = agent?.id
  }
  if (!agentId) {
    return res.status(400).json({ error: 'No hay agente configurado' })
  }

  // 3. Verificar que no sea un lead duplicado (mismo teléfono)
  const { data: existing } = await supabaseAdmin
    .from('leads')
    .select('id, status')
    .eq('phone', data.phone)
    .eq('agent_id', agentId)
    .single()

  if (existing && !['closed', 'lost'].includes(existing.status)) {
    return res.status(200).json({
      message: 'Lead ya existe',
      lead_id: existing.id,
      existing: true,
    })
  }

  // 4. Calcular score de precalificación
  const scoring = await calculateScore(
    {
      age: data.age,
      smoker: data.smoker,
      budget: data.budget as BudgetRange,
      urgency: data.urgency as UrgencyLevel,
      goal: data.goal as GoalType,
      phone: data.phone,
      contact_preference: data.contact_preference,
    },
    agentId
  )

  // 5. Crear lead en BD
  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .insert({
      agent_id: agentId,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      email: data.email || null,
      state: data.state,
      age: data.age,
      smoker: data.smoker,
      goal: data.goal,
      budget: data.budget,
      contact_preference: data.contact_preference,
      urgency: data.urgency,
      source: data.source || req.headers.referer?.split('/')[2] || 'web',
      utm_source: data.utm_source,
      utm_campaign: data.utm_campaign,
      ip_address: req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress,
      score: scoring.score,
      flags: scoring.flags,
      notes: scoring.recommendation,
      status: 'new',
    })
    .select()
    .single()

  if (error) {
    console.error('Error creando lead:', error)
    return res.status(500).json({ error: 'Error al crear lead' })
  }

  // 6. Crear documentos requeridos (checklist inicial)
  await supabaseAdmin.from('documents').insert([
    { lead_id: lead.id, doc_type: 'id', label: 'Identificación oficial (ID/Licencia)', required: true },
    { lead_id: lead.id, doc_type: 'proof_of_address', label: 'Comprobante de domicilio', required: false },
    { lead_id: lead.id, doc_type: 'beneficiary_form', label: 'Formulario de beneficiarios', required: true },
  ])

  // 7. Registrar en audit log
  await supabaseAdmin.from('audit_log').insert({
    lead_id: lead.id,
    agent_id: agentId,
    action: 'lead_created',
    details: { source: data.source, score: scoring.score },
  })

  // 8. Enviar mensaje de bienvenida automático
  const channel = data.contact_preference === 'whatsapp' ? 'whatsapp' : 'sms'
  await sendTemplatedMessage({
    to: data.phone,
    template: 'welcome',
    channel,
    variables: {
      first_name: data.first_name,
      schedule_link: `${process.env.NEXT_PUBLIC_APP_URL}/schedule/${lead.id}`,
    },
    leadId: lead.id,
    agentId,
    sequenceStep: 'day0',
  })

  // 9. Actualizar status a 'contacted'
  await supabaseAdmin
    .from('leads')
    .update({ status: 'contacted', last_contacted_at: new Date().toISOString() })
    .eq('id', lead.id)

  return res.status(201).json({
    message: 'Lead creado exitosamente',
    lead_id: lead.id,
    score: scoring.score,
    flags: scoring.flags,
    schedule_link: `${process.env.NEXT_PUBLIC_APP_URL}/schedule/${lead.id}`,
  })
}

// ── LISTAR LEADS (con filtros) ────────────────────────────────
async function getLeads(req: NextApiRequest, res: NextApiResponse) {
  // Auth: obtener agente de la sesión
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'No autorizado' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Token inválido' })

  const { data: agent } = await supabaseAdmin.from('agents').select('id').eq('user_id', user.id).single()
  if (!agent) return res.status(403).json({ error: 'Agente no encontrado' })

  // Filtros
  const { score, status, source, search, from, to, page = '1', limit = '20' } = req.query

  let query = supabaseAdmin
    .from('leads')
    .select('*, appointments(scheduled_at, status, appointment_type)', { count: 'exact' })
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .range((Number(page) - 1) * Number(limit), Number(page) * Number(limit) - 1)

  if (score) query = query.eq('score', score)
  if (status) query = query.eq('status', status)
  if (source) query = query.eq('source', source)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)
  if (search) {
    query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%`)
  }

  const { data: leads, count, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({
    leads,
    total: count,
    page: Number(page),
    pages: Math.ceil((count || 0) / Number(limit)),
  })
}
