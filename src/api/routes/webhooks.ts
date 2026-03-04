// src/api/routes/webhooks.ts
// POST /api/twilio/webhook — Recibir mensajes inbound de Twilio
// GET  /api/auth/google/callback — Callback de Google OAuth

import type { NextApiRequest, NextApiResponse } from 'next'
import { processInboundMessage, validateTwilioSignature } from '../../lib/twilio'
import { handleGoogleCallback } from '../../lib/google-calendar'
import { supabaseAdmin } from '../../lib/supabase'

// ── WEBHOOK DE TWILIO ─────────────────────────────────────────
// Configurar en Twilio Console:
//   Messaging > Phone Numbers > [tu número] > Webhook URL:
//   https://tudominio.com/api/twilio/webhook (HTTP POST)

export async function handleTwilioWebhook(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // 1. Validar firma de Twilio (seguridad)
  const signature = req.headers['x-twilio-signature'] as string
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/webhook`

  const isValid = validateTwilioSignature(signature, url, req.body)
  if (!isValid && process.env.NODE_ENV === 'production') {
    console.error('❌ Firma de Twilio inválida')
    return res.status(403).json({ error: 'Forbidden' })
  }

  // 2. Procesar mensaje entrante
  try {
    await processInboundMessage({
      From: req.body.From,
      Body: req.body.Body,
      MessageSid: req.body.MessageSid,
      To: req.body.To,
    })
  } catch (err) {
    console.error('Error procesando mensaje inbound:', err)
  }

  // 3. Responder a Twilio con TwiML vacío (sin respuesta automática adicional)
  res.setHeader('Content-Type', 'text/xml')
  return res.status(200).send('<Response></Response>')
}

// ── CALLBACK DE GOOGLE OAUTH ──────────────────────────────────
// Redirigir al agente a /api/auth/google después de conectar Calendar
export async function handleGoogleAuthCallback(req: NextApiRequest, res: NextApiResponse) {
  const { code, state: agentId } = req.query

  if (!code || !agentId) {
    return res.redirect('/dashboard/settings?error=google_auth_failed')
  }

  try {
    await handleGoogleCallback(code as string, agentId as string)
    return res.redirect('/dashboard/settings?success=google_calendar_connected')
  } catch (err) {
    console.error('Error en Google OAuth callback:', err)
    return res.redirect('/dashboard/settings?error=google_auth_failed')
  }
}

// ── WEBHOOK DE STATUS DE MENSAJES (Twilio) ────────────────────
// Configurar en Twilio Console > Messaging > Status Callback URL
export async function handleTwilioStatusCallback(req: NextApiRequest, res: NextApiResponse) {
  const { MessageSid, MessageStatus } = req.body

  if (MessageSid && MessageStatus) {
    await supabaseAdmin
      .from('messages')
      .update({ status: MessageStatus })
      .eq('twilio_sid', MessageSid)
  }

  return res.status(200).end()
}

// ── DOCUMENTS: UPLOAD URL SEGURA ─────────────────────────────
// POST /api/documents/[token]/upload
export async function getUploadUrl(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query

  // Validar token
  const { data: doc } = await supabaseAdmin
    .from('documents')
    .select('id, lead_id, doc_type, upload_token_expires_at')
    .eq('upload_token', token)
    .single()

  if (!doc) return res.status(404).json({ error: 'Token inválido' })

  if (new Date(doc.upload_token_expires_at) < new Date()) {
    return res.status(410).json({ error: 'El link de subida ha expirado' })
  }

  // Generar URL firmada para subir directamente a Supabase Storage
  const fileName = `${doc.lead_id}/${doc.doc_type}_${Date.now()}`
  const { data: uploadData, error } = await supabaseAdmin
    .storage
    .from('lead-documents')
    .createSignedUploadUrl(fileName)

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({
    upload_url: uploadData.signedUrl,
    path: fileName,
    document_id: doc.id,
  })
}

// POST /api/documents/[token]/confirm — Confirmar subida
export async function confirmUpload(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query
  const { path, file_name, file_size, file_type } = req.body

  const { data: doc } = await supabaseAdmin
    .from('documents')
    .select('id, lead_id, agent_id:leads(agent_id)')
    .eq('upload_token', token)
    .single()

  if (!doc) return res.status(404).json({ error: 'Token inválido' })

  await supabaseAdmin
    .from('documents')
    .update({
      file_path: path,
      file_name,
      file_size,
      file_type,
      status: 'uploaded',
      uploaded_at: new Date().toISOString(),
    })
    .eq('id', doc.id)

  // Verificar si todos los documentos requeridos están completos
  const { data: allDocs } = await supabaseAdmin
    .from('documents')
    .select('status, required')
    .eq('lead_id', doc.lead_id)

  const allRequired = allDocs?.filter(d => d.required) || []
  const allUploaded = allRequired.every(d => d.status === 'uploaded' || d.status === 'approved')

  if (allUploaded) {
    // Notificar al agente
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('first_name, phone, contact_preference, agent_id')
      .eq('id', doc.lead_id)
      .single()

    if (lead) {
      const channel = lead.contact_preference === 'whatsapp' ? 'whatsapp' : 'sms'
      const { sendTemplatedMessage } = await import('../../lib/twilio')
      await sendTemplatedMessage({
        to: lead.phone,
        template: 'docs_complete',
        channel,
        variables: { first_name: lead.first_name },
        leadId: doc.lead_id,
        agentId: lead.agent_id,
      })
    }
  }

  return res.status(200).json({ message: 'Documento subido exitosamente', all_complete: allUploaded })
}
