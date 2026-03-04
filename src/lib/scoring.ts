// src/lib/scoring.ts
// Motor de precalificación automática de leads

import { supabaseAdmin } from './supabase'
import type { LeadScore, BudgetRange, UrgencyLevel, GoalType } from './supabase'

interface LeadData {
  age?: number
  smoker: boolean
  budget: BudgetRange
  urgency: UrgencyLevel
  goal?: GoalType
  phone?: string
  contact_preference?: string
}

interface ScoringResult {
  score: LeadScore
  flags: string[]
  recommendation: string
  script: string
}

// ── MOTOR DE SCORING BASADO EN REGLAS ─────────────────────────
export async function calculateScore(
  leadData: LeadData,
  agentId?: string
): Promise<ScoringResult> {
  const flags: string[] = []
  let score: LeadScore = 'cold'
  let scorePoints = 0

  // Si hay agente, usar sus reglas personalizadas
  if (agentId) {
    const result = await calculateScoreFromDB(leadData, agentId)
    if (result) return result
  }

  // Reglas por defecto (fallback)
  const { age, smoker, budget, urgency, goal, phone } = leadData

  // ── SCORE POR URGENCIA ────────────────────────────────────
  if (urgency === 'today') scorePoints += 40
  else if (urgency === 'this_week') scorePoints += 25
  else scorePoints += 5 // info_only

  // ── SCORE POR PRESUPUESTO ─────────────────────────────────
  if (budget === '100_plus') scorePoints += 35
  else if (budget === '50_100') scorePoints += 20
  else scorePoints += 5 // 25_50

  // ── MODIFICADORES ─────────────────────────────────────────
  if (!smoker) scorePoints += 10 // No fumador = más opciones
  if (!phone) scorePoints -= 30   // Sin teléfono = muy frío

  // ── BANDERAS ──────────────────────────────────────────────
  if (smoker) {
    flags.push('🚬 Fumador → Ajustar expectativas, verificar productos disponibles')
    scorePoints -= 10
  }

  if (age && age >= 55) {
    flags.push('👴 Edad 55+ → Considerar Final Expenses como producto principal')
    if (budget === '25_50') scorePoints -= 10
  }

  if (age && age >= 65) {
    flags.push('⚠️ Edad 65+ → Opciones muy limitadas, manejo especial necesario')
    scorePoints -= 20
  }

  if (budget === '25_50') {
    flags.push('💰 Presupuesto bajo → Ofrecer opciones básicas de term life')
  }

  if (urgency === 'info_only' && budget === '25_50') {
    flags.push('❄️ Baja urgencia + presupuesto bajo → Seguimiento largo plazo')
    scorePoints -= 15
  }

  if (goal === 'final_expenses' || (age && age >= 60)) {
    flags.push('📋 Perfil Final Expenses → Considerar Mutual of Omaha, Aetna, etc.')
  }

  if (goal === 'mortgage') {
    flags.push('🏠 Hipoteca → Term Life aligned con duración del préstamo')
  }

  if (goal === 'business') {
    flags.push('💼 Negocio → Considerar Key Person o Buy-Sell Agreement')
    scorePoints += 5
  }

  // ── CONVERTIR PUNTOS A SCORE ──────────────────────────────
  if (scorePoints >= 60) score = 'hot'
  else if (scorePoints >= 30) score = 'warm'
  else score = 'cold'

  return {
    score,
    flags,
    recommendation: getRecommendation(score, leadData),
    script: generateScript(leadData, score, flags),
  }
}

// ── SCORING DESDE REGLAS EN BD ────────────────────────────────
async function calculateScoreFromDB(leadData: LeadData, agentId: string): Promise<ScoringResult | null> {
  const { data: rules } = await supabaseAdmin
    .from('scoring_rules')
    .select('*')
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .order('priority', { ascending: false })

  if (!rules?.length) return null

  const flags: string[] = []
  let scoreImpacts: LeadScore[] = []

  for (const rule of rules) {
    const fieldValue = (leadData as any)[rule.field]
    let matches = false

    switch (rule.operator) {
      case 'equals':
        matches = String(fieldValue) === rule.value
        break
      case 'gte':
        matches = Number(fieldValue) >= Number(rule.value)
        break
      case 'lte':
        matches = Number(fieldValue) <= Number(rule.value)
        break
      case 'contains':
        matches = String(fieldValue).toLowerCase().includes(rule.value.toLowerCase())
        break
    }

    if (matches) {
      scoreImpacts.push(rule.score_impact as LeadScore)
      if (rule.flag_message) flags.push(rule.flag_message)
    }
  }

  // El score final es el más alto que matcheó
  const priority: Record<LeadScore, number> = { hot: 3, warm: 2, cold: 1 }
  const score = scoreImpacts.reduce<LeadScore>(
    (best, curr) => priority[curr] > priority[best] ? curr : best,
    'cold'
  )

  return {
    score,
    flags,
    recommendation: getRecommendation(score, leadData),
    script: generateScript(leadData, score, flags),
  }
}

// ── RECOMENDACIÓN DE ENFOQUE ──────────────────────────────────
function getRecommendation(score: LeadScore, data: LeadData): string {
  if (score === 'hot') {
    return `Lead caliente. Contactar en las próximas 2 horas. ` +
      (data.urgency === 'today' ? 'Prioridad máxima — quiere hablar HOY.' : 'Llamar o enviar link de Zoom de inmediato.')
  }
  if (score === 'warm') {
    return `Lead tibio. Contactar hoy o mañana. ` +
      `Enviar link de agenda y hacer follow-up en 24-48h si no responde.`
  }
  return `Lead frío. Incluir en secuencia automática. ` +
    `Seguimiento a 24h, 72h y 7 días. No priorizar sobre leads calientes.`
}

// ── GENERADOR DE GUIÓN ────────────────────────────────────────
function generateScript(data: LeadData, score: LeadScore, flags: string[]): string {
  const goalMap: Record<string, string> = {
    family: 'proteger a su familia',
    mortgage: 'cubrir su hipoteca',
    business: 'proteger su negocio',
    final_expenses: 'cubrir gastos finales',
  }
  const goalText = data.goal ? goalMap[data.goal] : 'sus necesidades de seguro de vida'
  const budgetText = data.budget === '100_plus' ? 'más de $100' : data.budget === '50_100' ? '$50-$100' : '$25-$50'

  const hasSmokerFlag = flags.some(f => f.includes('Fumador'))
  const hasFinalExpenses = flags.some(f => f.includes('Final Expenses'))

  let script = `**Apertura:**\n`
  script += `"Hola, ¿puedo hablar con [nombre]? Te llamo de LifeShield Pro, me compartiste tu información para una cotización de seguro de vida."\n\n`
  script += `**Verificación:**\n`
  script += `"Vi que tu objetivo es ${goalText} y tienes un presupuesto de ${budgetText}/mes. ¿Es correcto?"\n\n`
  script += `**Preguntas clave:**\n`

  if (hasSmokerFlag) {
    script += `- "¿Actualmente fumas? ¿Cuántos por día?" → Para filtrar productos\n`
    script += `- Mencionar que aún hay opciones disponibles aunque sea fumador\n`
  }

  if (hasFinalExpenses) {
    script += `- Mencionar productos de Final Expenses (Guaranteed Issue, Simplified Issue)\n`
    script += `- Preguntar sobre condiciones de salud preexistentes\n`
  }

  script += `- "¿Tienes algún seguro de vida actualmente?"\n`
  script += `- "¿Hay algo específico que te preocupe o que quieras cubrir?"\n\n`
  script += `**Cierre:**\n`
  script += `"Perfecto, con esa información puedo prepararte una cotización personalizada. ¿Tienes ${data.urgency === 'today' ? '10 minutos ahora mismo' : 'disponibilidad esta semana'} para revisar las opciones juntos?"`

  return script
}
