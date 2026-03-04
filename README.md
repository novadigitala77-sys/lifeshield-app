# LifeShield Pro — Guía Completa de Instalación y Despliegue

## 📋 Tabla de contenidos
1. Requisitos previos
2. Setup de Supabase
3. Setup de Twilio
4. Setup de Google Calendar
5. Setup de Email (Resend)
6. Instalación y configuración
7. Despliegue en producción (Vercel)
8. Configurar cron jobs
9. Pruebas
10. Estructura de archivos

---

## 1. Requisitos Previos

- Node.js 18+ instalado
- Cuenta en [Supabase](https://supabase.com) (gratuita)
- Cuenta en [Twilio](https://twilio.com) (~$1/mes por número)
- Cuenta en [Google Cloud Console](https://console.cloud.google.com) (gratuita)
- Cuenta en [Resend](https://resend.com) (gratuita hasta 3000 emails/mes)
- Cuenta en [Vercel](https://vercel.com) para despliegue (gratuita)

**Costo aproximado mensual:**
- Supabase Free tier: $0
- Twilio número + SMS: ~$5-20/mes según volumen
- Vercel: $0 (plan hobby)
- Resend: $0 (hasta 3000 emails)
- **Total estimado: $5-20/mes**

---

## 2. Setup de Supabase

### 2.1 Crear proyecto
1. Ve a https://supabase.com y crea una cuenta
2. Crea un nuevo proyecto (anota la contraseña de la BD)
3. Espera a que el proyecto inicie (~2 min)

### 2.2 Ejecutar schema de la BD
1. En Supabase: **SQL Editor** > **New Query**
2. Pega el contenido de `supabase/migrations/001_schema.sql`
3. Click **Run** ✅
4. Repite con `supabase/migrations/002_seed.sql`

### 2.3 Configurar Storage
1. En Supabase: **Storage** > **New Bucket**
2. Nombre: `lead-documents`
3. **Public**: NO (privado)
4. Guarda

### 2.4 Obtener credenciales
1. **Settings** > **API**
2. Copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

---

## 3. Setup de Twilio

### 3.1 Número de teléfono
1. Ve a https://console.twilio.com
2. **Phone Numbers** > **Manage** > **Buy a Number**
3. Busca número de tu estado (ej. Florida: área 305, 786)
4. Activa **SMS capabilities**
5. Compra (~$1/mes)

### 3.2 Credenciales
1. En el dashboard de Twilio, copia:
   - `Account SID` → `TWILIO_ACCOUNT_SID`
   - `Auth Token` → `TWILIO_AUTH_TOKEN`
   - El número comprado → `TWILIO_PHONE_NUMBER`

### 3.3 Configurar Webhook (después del despliegue)
1. **Phone Numbers** > tu número > **Configure**
2. En **Messaging Configuration**:
   - Webhook URL: `https://tu-app.vercel.app/api/twilio/webhook`
   - HTTP Method: `POST`
3. **Status Callback URL**: `https://tu-app.vercel.app/api/twilio/status`
4. Guarda ✅

### 3.4 WhatsApp Sandbox (para desarrollo)
1. **Messaging** > **Try it out** > **WhatsApp**
2. Sigue las instrucciones para unirte al sandbox
3. El número del sandbox va en `TWILIO_WHATSAPP_NUMBER`

> Para producción con WhatsApp necesitas aprobación de Meta Business
> (proceso de 1-2 semanas). Mientras tanto usa el sandbox para pruebas.

---

## 4. Setup de Google Calendar

### 4.1 Crear proyecto en Google Cloud
1. Ve a https://console.cloud.google.com
2. **Nuevo proyecto** > nombre: "LifeShield Pro"
3. **APIs y servicios** > **Biblioteca**
4. Busca y habilita: **Google Calendar API**

### 4.2 Crear credenciales OAuth 2.0
1. **APIs y servicios** > **Credenciales** > **+ Crear credenciales** > **ID de cliente OAuth**
2. Tipo: **Aplicación web**
3. Nombre: "LifeShield Pro"
4. Orígenes autorizados: `http://localhost:3000` y `https://tu-app.vercel.app`
5. URIs de redireccionamiento:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://tu-app.vercel.app/api/auth/google/callback`
6. Guarda y descarga el JSON
7. Copia `client_id` → `GOOGLE_CLIENT_ID` y `client_secret` → `GOOGLE_CLIENT_SECRET`

### 4.3 Obtener Refresh Token
1. Una vez desplegada la app, ve a:
   `http://localhost:3000/api/auth/google?agent_id=TU_AGENT_ID`
2. Autoriza el acceso a tu Google Calendar
3. El refresh token se guardará automáticamente en la BD

---

## 5. Setup de Email (Resend)

1. Ve a https://resend.com y crea cuenta
2. **API Keys** > **Create API Key**
3. Copia la key → `RESEND_API_KEY`
4. Verifica tu dominio en Resend (o usa el dominio de prueba)
5. Actualiza `EMAIL_FROM` con tu email verificado

---

## 6. Instalación Local

```bash
# 1. Clonar/copiar el proyecto
cd lifeshield-pro

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env.local
# Edita .env.local con tus credenciales reales

# 4. Iniciar en desarrollo
npm run dev

# 5. Abrir en el navegador
# http://localhost:3000
```

### Registro del primer agente
1. Ve a `http://localhost:3000/auth/register`
2. Crea tu cuenta de agente
3. Ejecuta el seed SQL en Supabase para crear plantillas
4. Conecta Google Calendar desde Settings

---

## 7. Despliegue en Vercel

```bash
# 1. Instalar Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel

# 4. Configurar variables de entorno en Vercel
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
# ... (repetir para todas las variables de .env.example)

# O configurarlas desde el dashboard de Vercel:
# vercel.com > Tu proyecto > Settings > Environment Variables

# 5. Deploy a producción
vercel --prod
```

> **Importante**: Después del despliegue, actualiza el Webhook de Twilio
> con la URL de producción de Vercel.

---

## 8. Configurar Cron Jobs

Los cron jobs se ejecutan automáticamente si tienes pg_cron en Supabase.
Para configurarlos manualmente con Vercel Cron:

### vercel.json
```json
{
  "crons": [
    {
      "path": "/api/cron/reminders",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/sequences",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

> Los cron jobs en Vercel requieren el plan Pro ($20/mes).
> **Alternativa gratuita**: Usa https://cron-job.org con tu CRON_SECRET.

---

## 9. Flujo de Pruebas

### Probar formulario de cliente
1. Ve a `http://localhost:3000` (o tu URL de Vercel)
2. Completa el formulario de lead
3. Verifica que se crea en Supabase: **Table Editor** > **leads**
4. Verifica que llegó el SMS (si Twilio está configurado)

### Probar webhook de Twilio
```bash
# Usar ngrok en desarrollo para exponer localhost
npx ngrok http 3000

# Actualizar el webhook de Twilio con la URL de ngrok:
# https://xxxx.ngrok.io/api/twilio/webhook
```

### Probar cron jobs manualmente
```bash
# Recordatorios
curl -H "Authorization: Bearer TU_CRON_SECRET" \
  http://localhost:3000/api/cron/reminders

# Secuencias
curl -H "Authorization: Bearer TU_CRON_SECRET" \
  http://localhost:3000/api/cron/sequences
```

---

## 10. Estructura de Archivos

```
lifeshield-pro/
├── .env.example              ← Variables de entorno (plantilla)
├── package.json              ← Dependencias
├── vercel.json               ← Config de Vercel + cron jobs
├── supabase/
│   └── migrations/
│       ├── 001_schema.sql    ← Schema completo de la BD
│       └── 002_seed.sql      ← Datos iniciales (plantillas, reglas)
└── src/
    ├── lib/
    │   ├── supabase.ts        ← Cliente de Supabase + tipos
    │   ├── twilio.ts          ← SMS, WhatsApp, webhook handler
    │   ├── google-calendar.ts ← Google Calendar API
    │   └── scoring.ts         ← Motor de precalificación
    └── api/
        └── routes/
            ├── leads.ts        ← POST/GET /api/leads
            ├── appointments.ts ← Citas + slots disponibles
            ├── cron.ts         ← Recordatorios + secuencias
            ├── webhooks.ts     ← Twilio webhook + Google OAuth
            └── reports.ts      ← Métricas y reportes
```

---

## 🆘 Problemas Comunes

| Problema | Solución |
|----------|----------|
| SMS no llegan | Verificar TWILIO_PHONE_NUMBER con formato +1XXXXXXXXXX |
| Google Calendar no conecta | Verificar GOOGLE_REDIRECT_URI match exacto con Google Cloud |
| Error "no agent configured" | Registrarse en /auth/register primero |
| Cron no ejecuta | Verificar CRON_SECRET en variables de Vercel |
| Documentos no suben | Verificar que bucket 'lead-documents' existe en Supabase |

---

## 📞 Flujo completo verificado

```
1. Lead completa formulario → POST /api/leads
   ↓ Score calculado automáticamente
   ↓ SMS/WhatsApp de bienvenida enviado
   
2. Lead elige horario → GET /api/appointments/slots
   ↓ POST /api/appointments
   ↓ Evento creado en Google Calendar
   ↓ SMS de confirmación enviado

3. Cron cada hora → GET /api/cron/reminders
   ↓ Recordatorio 24h antes
   ↓ Recordatorio 2h antes

4. Lead responde SMS → POST /api/twilio/webhook
   ↓ Detecta "1" → confirma cita
   ↓ Detecta "2" → envía link de reprogramación

5. Lead no responde → GET /api/cron/sequences
   ↓ Follow-up 24h, 72h, 7 días
   ↓ Después del 7mo día → marca como perdido

6. Agente ve todo en Dashboard → GET /api/leads
   ↓ Filtros, detalle, historial, acciones rápidas
```
