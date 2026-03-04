// src/api/routes/cron.ts
// Endpoints protegidos que Supabase pg_cron llama periódicamente
// GET /api/cron/reminders  — Enviar recordatorios de citas
// GET /api/cron/sequences  — Ejecutar secuencias de seguimiento

import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin } from '../../lib/supabase'
import { sendTemplatedMessage, sendRawMessage } from '../../lib/twilio'
import { format, parseISO, isWithin24Hours } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

// ── MIDDLEWARE DE AUTENTICACIÓN CRON ──────────────────────────
function validateCronRequest(req: NextApiRequest): boolean {
  const auth = req.headers.authorization
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

// ── RECORDATORIOS DE CITAS ────────────────────────────────────
export async function runReminders(req: NextApiRequest, res: NextApiResponse) {
  if (!validateCronRequest(req)) return res.status(401).json({ error: 'No autorizado' })

  const now = new Date()
  let sent = 0

  // Buscar citas que necesitan recordatorio
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('*, leads(first_name, phone, contact_preference, email, agents(timezone, zoom_link))')
    .in('status', ['scheduled', 'confirmed'])
    .gt('scheduled_at', now.toISOString())

  if (!appointments) return res.status(200).json({ sent: 0 })

  for (const appt of appointments) {
    const lead = appt.leads as any
    const tz = lead?.agents?.timezone || 'America/New_York'
    const scheduledAt = parseISO(appt.scheduled_at)
    const hoursUntil = (scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60)
    const channel = lead?.contact_preference === 'whatsapp' ? 'whatsapp' : 'sms'

    const apptDateFmt = format(toZonedTime(scheduledAt, tz), "EEEE d 'de' MMMM")
    const apptTimeFmt = format(toZonedTime(scheduledAt, tz), 'h:mm a')
    const meetingLink = appt.zoom_link || appt.google_meet_link || ''
    const rescheduleLink = `${process.env.NEXT_PUBLIC_APP_URL}/reschedule/${appt.reschedule_token}`

    const vars = {
      first_name: lead?.first_name || '',
      appointment_date: apptDateFmt,
      appointment_time: apptTimeFmt,
      appointment_type: appt.appointment_type,
      meeting_link: meetingLink,
      reschedule_link: rescheduleLink,
    }

    // ── Recordatorio 24h ──
    if (hoursUntil <= 25 && hoursUntil > 23 && !appt.reminded_24h_at) {
      await sendTemplatedMessage({
        to: lead.phone, template: 'reminder_24h', channel, variables: vars,
        leadId: appt.lead_id, agentId: appt.agent_id,
      })
      await supabaseAdmin.from('appointments').update({ reminded_24h_at: now.toISOString() }).eq('id', appt.id)
      sent++
    }

    // ── Recordatorio 2h ──
    if (hoursUntil <= 2.5 && hoursUntil > 1.5 && !appt.reminded_2h_at) {
      await sendTemplatedMessage({
        to: lead.phone, template: 'reminder_2h', channel, variables: vars,
        leadId: appt.lead_id, agentId: appt.agent_id,
      })
      await supabaseAdmin.from('appointments').update({ reminded_2h_at: now.toISOString() }).eq('id', appt.id)
      sent++
    }

    // ── Recordatorio 15min ──
    const minsUntil = (scheduledAt.getTime() - now.getTime()) / (1000 * 60)
    if (minsUntil <= 20 && minsUntil > 10 && !appt.reminded_15m_at) {
      await sendRawMessage({
        to: lead.phone, channel,
        body: `⏰ Tu cita empieza en 15 minutos${meetingLink ? ': ' + meetingLink : ''}`,
        leadId: appt.lead_id, agentId: appt.agent_id,
      })
      await supabaseAdmin.from('appointments').update({ reminded_15m_at: now.toISOString() }).eq('id', appt.id)
      sent++
    }

    // ── Marcar como no-show si pasó 1h ──
    if (hoursUntil < -1 && appt.status !== 'completed' && appt.status !== 'no_show') {
      await supabaseAdmin.from('appointments').update({ status: 'no_show' }).eq('id', appt.id)
      await supabaseAdmin.from('leads').update({ status: 'contacted' }).eq('id', appt.lead_id)
    }
  }

  console.log(`✅ Cron reminders: ${sent} enviados`)
  return res.status(200).json({ sent, processed: appointments.length })
}

// ── SECUENCIAS DE SEGUIMIENTO ─────────────────────────────────
export async function runSequences(req: NextApiRequest, res: NextApiResponse) {
  if (!validateCronRequest(req)) return res.status(401).json({ error: 'No autorizado' })

  const now = new Date()
  let sent = 0

  // Leads que no han respondido y no tienen secuencia pausada
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('*, agents(timezone)')
    .eq('sequence_paused', false)
    .in('status', ['new', 'contacted'])
    .not('sequence_step', 'eq', 'day7') // No enviar más allá del día 7

  if (!leads) return res.status(200).json({ sent: 0 })

  for (const lead of leads) {
    const channel = lead.contact_preference === 'whatsapp' ? 'whatsapp' : 'sms'
    const createdAt = new Date(lead.created_at)
    const hoursSinceCreated = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)
    const scheduleLink = `${process.env.NEXT_PUBLIC_APP_URL}/schedule/${lead.id}`
    const vars = { first_name: lead.first_name, schedule_link: scheduleLink }

    // Determinar qué paso enviar basado en tiempo transcurrido y step actual
    let shouldSend = false
    let nextStep = lead.sequence_step

    if (lead.sequence_step === 'day0' && hoursSinceCreated >= 23) {
      shouldSend = true
      nextStep = 'day1'
      await sendTemplatedMessage({
        to: lead.phone, template: 'followup_24h', channel, variables: vars,
        leadId: lead.id, agentId: lead.agent_id, sequenceStep: 'day1',
      })
    } else if (lead.sequence_step === 'day1' && hoursSinceCreated >= 71) {
      shouldSend = true
      nextStep = 'day3'
      await sendTemplatedMessage({
        to: lead.phone, template: 'followup_72h', channel, variables: vars,
        leadId: lead.id, agentId: lead.agent_id, sequenceStep: 'day3',
      })
    } else if (lead.sequence_step === 'day3' && hoursSinceCreated >= 167) {
      shouldSend = true
      nextStep = 'day7'
      await sendTemplatedMessage({
        to: lead.phone, template: 'followup_7d', channel, variables: vars,
        leadId: lead.id, agentId: lead.agent_id, sequenceStep: 'day7',
      })
      // Marcar como frío después del último follow-up
      await supabaseAdmin.from('leads').update({ score: 'cold', status: 'lost' }).eq('id', lead.id)
    }

    if (shouldSend) {
      await supabaseAdmin.from('leads').update({
        sequence_step: nextStep,
        last_contacted_at: now.toISOString(),
      }).eq('id', lead.id)
      sent++
    }
  }

  console.log(`✅ Cron sequences: ${sent} mensajes enviados`)
  return res.status(200).json({ sent, total_leads: leads.length })
}
