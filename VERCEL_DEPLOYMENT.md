# ValidTeam Vercel Deployment Guide

Deploy ValidTeam to Vercel with Neon (PostgreSQL) and Upstash (Redis).

## Prerequisites

- GitHub account (already connected)
- Neon account (https://neon.tech)
- Upstash account (https://upstash.com)
- Vercel account (https://vercel.com)

## Step 1: Set up Neon PostgreSQL

1. **Create Neon Project:**
   - Go to https://console.neon.tech
   - Create a new project
   - Choose PostgreSQL 16
   - Wait for it to initialize

2. **Enable pgvector Extension:**
   - In Neon Console → SQL Editor
   - Run: `CREATE EXTENSION IF NOT EXISTS vector;`

3. **Get Connection String:**
   - Copy the connection string (looks like: `postgresql://user:password@host/dbname`)
   - This becomes your `DATABASE_URL`

## Step 2: Set up Upstash Redis

1. **Create Upstash Redis:**
   - Go to https://console.upstash.com
   - Create a new Redis database
   - Choose Global or closest region
   - Copy the connection string and password

2. **Get Redis Credentials:**
   - `REDIS_URL`: Connection string from Upstash
   - `REDIS_PASSWORD`: Your Redis password

## Step 3: Generate Required Secrets

```bash
# Generate AUTH_SECRET (run locally)
openssl rand -base64 32

# Generate CRON_SECRET
openssl rand -hex 32
```

## Step 4: Create .env.production

Create a local `.env.production` file with all required variables:

```env
# Application
APP_URL=https://your-domain.vercel.app
NEXTAUTH_URL=https://your-domain.vercel.app
AUTH_SECRET=<your-generated-secret>

# Database (from Neon)
DATABASE_URL=postgresql://user:password@host/dbname

# Redis (from Upstash)
REDIS_URL=redis://default:password@host:port
REDIS_PASSWORD=<your-redis-password>

# Cron
CRON_SECRET=<your-generated-secret>

# Optional OAuth (leave blank if not using)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional features (disable for initial setup)
NEXT_PUBLIC_COLLAB_ENABLED=false
VALIDTEAM_WEBHOOK_ALLOW_INSECURE_HTTP=false
```

## Step 5: Deploy to Vercel

### Option A: Using Vercel UI

1. Go to https://vercel.com/new
2. Select "Import Git Repository"
3. Paste: `https://github.com/pogutu-pro/ValidTeam`
4. Click Import

### Option B: Using Vercel CLI

```bash
npm i -g vercel
cd /home/ogutu/Documents/HIGH-END-PROJECTS/ValidTeam
vercel
```

### Set Environment Variables in Vercel:

1. In Vercel Dashboard → Project Settings → Environment Variables
2. Add all variables from `.env.production`
3. Make sure variables are available in: Production, Preview, Development

## Step 6: Deploy

1. **Via UI:** Click "Deploy" after adding env vars
2. **Via CLI:** Run `vercel --prod`

## Step 7: Run Migrations

Migrations do **not** run automatically on Vercel. The auto-run lives in the
Docker entrypoint (`docker-entrypoint.sh`), which Vercel does not use. Run them
against Neon _before_ the app serves traffic, or it will hit an empty schema.

```bash
# Use db:migrate:prod (not db:migrate) for a production database.
DATABASE_URL="postgresql://..." pnpm db:migrate:prod
```

Run this before the first deploy, then again after any release that ships new
migrations. There are 69 migrations in `packages/db/drizzle/`, including
`0062_collab_documents.sql`, which collaborative editing depends on.

## Step 8: Test the Deployment

Visit your Vercel URL:

```
https://your-project.vercel.app
```

1. Click "Sign Up"
2. Create a test account
3. Create a workspace
4. Test creating an issue

## Troubleshooting

### Database Connection Failed

- Verify `DATABASE_URL` is correct from Neon
- Check Neon network restrictions
- Ensure pgvector extension is enabled

### Redis Connection Failed

- Verify `REDIS_URL` from Upstash
- Check Upstash password
- Ensure TLS is enabled in Upstash settings

### Migrations Failed

- Run manually: `DATABASE_URL="..." pnpm db:migrate`
- Check database exists and has correct schema

### Health Check Failing

- Visit `/api/health` to see error details
- Verify all environment variables are set
- Check logs in Vercel dashboard

## Optional: Custom Domain

1. In Vercel Dashboard → Settings → Domains
2. Add your domain
3. Follow DNS setup instructions

## Post-Deployment

### Monitoring

- **Logs:** Vercel Dashboard → Deployments → Logs
- **Health:** `https://your-domain.vercel.app/api/health`
- **Database:** Neon Console for metrics

### Scaling

- Vercel scales automatically
- Neon automatically scales on demand
- Upstash auto-scales with usage

### Backups

- Neon automatic backups (7 days free)
- Manual backups in Neon console

## Next Steps

1. **Enable OAuth** (optional, currently incomplete in codebase)
2. **Enable Collaborative Editing** (requires Hocuspocus deployment)
3. **Enable Voice/Video** (requires LiveKit deployment)
4. **Set up Custom Domain**
5. **Configure Email/SMTP** (optional)

---

**Status:** Ready for deployment
**Last Updated:** 2026-09-27
