// src/api/routes/reports.ts
// GET /api/reports — Métricas y estadísticas del agente

import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin } from '../../lib/supabase'
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, format } from 'date-fns'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  // Auth
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'No autorizado' })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return res.status(401).json({ error: 'Token inválido' })

  const { data: agent } = await supabaseAdmin.from('agents').select('id').eq('user_id', user.id).single()
  if (!agent) return res.status(403).end()

  const agentId = agent.id
  const { period = 'month' } = req.query

  const now = new Date()
  const from = period === 'week' ? subDays(now, 7) : period === 'month' ? startOfMonth(now) : subDays(now, 1)
  const to = period === 'month' ? endOfMonth(now) : endOfDay(now)

  // ── LEADS ESTE PERÍODO ────────────────────────────────────
  const { count: totalLeads } = await supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString())

  // ── LEADS POR SCORE ───────────────────────────────────────
  const { data: byScore } = await supabaseAdmin.rpc('count_leads_by_score', {
    p_agent_id: agentId, p_from: from.toISOString(), p_to: to.toISOString()
  }) as any

  // ── CITAS AGENDADAS ───────────────────────────────────────
  const { count: totalAppointments } = await supabaseAdmin
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .gte('created_at', from.toISOString())

  // ── CITAS COMPLETADAS (SHOW RATE) ─────────────────────────
  const { count: completedAppointments } = await supabaseAdmin
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('status', 'completed')
    .gte('created_at', from.toISOString())

  // ── LEADS POR FUENTE ──────────────────────────────────────
  const { data: allLeads } = await supabaseAdmin
    .from('leads')
    .select('source, score, status, created_at')
    .eq('agent_id', agentId)
    .gte('created_at', from.toISOString())

  const bySource = groupBy(allLeads || [], 'source')
  const byStatus = groupBy(allLeads || [], 'status')

  // ── PÓLIZAS CERRADAS ──────────────────────────────────────
  const { count: closed } = await supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('status', 'closed')
    .gte('updated_at', from.toISOString())

  // ── DOCUMENTOS COMPLETOS ──────────────────────────────────
  const { data: docsData } = await supabaseAdmin
    .from('documents')
    .select('lead_id, status')
    .eq('status', 'uploaded')
    .gte('uploaded_at', from.toISOString())

  const uniqueLeadsWithDocs = new Set(docsData?.map(d => d.lead_id) || []).size

  // ── LEADS POR DÍA (últimos 30 días) ──────────────────────
  const { data: last30Days } = await supabaseAdmin
    .from('leads')
    .select('created_at')
    .eq('agent_id', agentId)
    .gte('created_at', subDays(now, 30).toISOString())

  const dailyCounts: Record<string, number> = {}
  for (let i = 29; i >= 0; i--) {
    const d = format(subDays(now, i), 'MM/dd')
    dailyCounts[d] = 0
  }
  last30Days?.forEach(l => {
    const d = format(new Date(l.created_at), 'MM/dd')
    if (dailyCounts[d] !== undefined) dailyCounts[d]++
  })

  // ── TIEMPO PROMEDIO LEAD → CITA ────────────────────────────
  const { data: convertedLeads } = await supabaseAdmin
    .from('leads')
    .select('created_at, appointments(created_at)')
    .eq('agent_id', agentId)
    .gte('created_at', from.toISOString())
    .not('appointments', 'is', null)

  let avgDaysToAppt = 0
  if (convertedLeads?.length) {
    const diffs = convertedLeads
      .filter(l => (l.appointments as any)?.created_at)
      .map(l => {
        const apptDate = new Date((l.appointments as any).created_at)
        const leadDate = new Date(l.created_at)
        return (apptDate.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24)
      })
    avgDaysToAppt = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0
  }

  // ── RESPONSE ──────────────────────────────────────────────
  return res.status(200).json({
    period,
    summary: {
      total_leads: totalLeads || 0,
      total_appointments: totalAppointments || 0,
      completed_appointments: completedAppointments || 0,
      show_rate: totalAppointments ? Math.round(((completedAppointments || 0) / totalAppointments) * 100) : 0,
      closed_policies: closed || 0,
      leads_with_docs: uniqueLeadsWithDocs,
      conversion_rate: totalLeads ? Math.round(((totalAppointments || 0) / totalLeads) * 100) : 0,
      avg_days_to_appointment: Math.round(avgDaysToAppt * 10) / 10,
    },
    by_score: {
      hot: countByField(allLeads || [], 'score', 'hot'),
      warm: countByField(allLeads || [], 'score', 'warm'),
      cold: countByField(allLeads || [], 'score', 'cold'),
    },
    by_status: byStatus,
    by_source: bySource,
    daily_leads: Object.entries(dailyCounts).map(([date, count]) => ({ date, count })),
  })
}

// ── HELPERS ───────────────────────────────────────────────────
function groupBy(arr: any[], key: string): Record<string, number> {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'unknown'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
}

function countByField(arr: any[], field: string, value: string): number {
  return arr.filter(item => item[field] === value).length
}
