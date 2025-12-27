# Deploying TCL Core

This guide covers deploying the TCL Core service to various platforms.

## Quick Comparison

| Platform | Free Tier | Best For | Difficulty |
|----------|-----------|----------|------------|
| **Railway** | $5 credit/month | Easiest setup | ⭐ Easy |
| **Render** | 750 hrs/month | Free tier available | ⭐ Easy |
| **Fly.io** | 3 VMs free | Good performance | ⭐⭐ Medium |
| **Heroku** | None (paid) | Familiar platform | ⭐ Easy |

## Option 1: Railway (Recommended)

### Why Railway?
- ✅ Easiest setup
- ✅ $5 free credit/month
- ✅ Auto-deploy from GitHub
- ✅ Built-in environment variables
- ✅ Good for Node.js apps

### Steps

1. **Push code to GitHub** (if not already)

2. **Go to [Railway](https://railway.app)**
   - Sign in with GitHub
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Configure the service**
   - Railway auto-detects Node.js
   - Set **Root Directory**: `packages/tcl-core`
   - Set **Start Command**: `npm run dev` (or build first, see below)

4. **Set Environment Variables**
   - Click on your service → Variables
   - Add:
     - `PORT` = `8787` (or let Railway auto-assign)
     - `TCL_SPECTRAL_URL` = `http://your-spectral-service:8080` (if using Spectral)
     - `OPENAI_API_KEY` = `your-key` (if using LLM adapter)

5. **Deploy**
   - Railway automatically deploys on push
   - Get your URL: `https://your-app.up.railway.app`

### Production Build (Optional)

For production, you might want to build first:

1. Add to `package.json`:
```json
"scripts": {
  "start": "node dist/server/express.js",
  "build": "tsc -p tsconfig.json",
  "dev": "node --loader ts-node/esm src/server/express.ts"
}
```

2. Set Railway start command: `npm run build && npm start`

## Option 2: Render

### Why Render?
- ✅ 750 free hours/month
- ✅ Auto-deploy from GitHub
- ✅ Free tier available
- ⚠️ Sleeps after 15 min (wakes on request)

### Steps

1. **Push code to GitHub**

2. **Go to [Render](https://render.com)**
   - Sign in with GitHub
   - Click "New +" → "Web Service"
   - Connect your repository

3. **Configure**
   - **Name**: `tcl-core` (or your choice)
   - **Environment**: `Node`
   - **Root Directory**: `packages/tcl-core`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run dev`
   - **Plan**: Free (or paid for always-on)

4. **Environment Variables**
   - Add in Render dashboard:
     - `PORT` = `10000` (Render assigns, but you can set)
     - `TCL_SPECTRAL_URL` = `http://your-spectral:8080`
     - `OPENAI_API_KEY` = `your-key`

5. **Deploy**
   - Click "Create Web Service"
   - Get URL: `https://tcl-core.onrender.com`

### Note on Free Tier
- Service sleeps after 15 min of inactivity
- First request after sleep takes ~30 seconds (cold start)
- Consider paid plan ($7/month) for always-on

## Option 3: Fly.io

### Why Fly.io?
- ✅ 3 free VMs
- ✅ Good performance
- ✅ Global edge network
- ⚠️ More setup required

### Steps

1. **Install Fly CLI**
```bash
curl -L https://fly.io/install.sh | sh
```

2. **Login**
```bash
fly auth login
```

3. **Create app**
```bash
cd packages/tcl-core
fly launch
```
- Follow prompts
- Choose region
- Don't deploy yet

4. **Create `fly.toml`** (if not auto-generated)
```toml
app = "your-app-name"
primary_region = "iad"

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  PORT = "8787"

[[services]]
  internal_port = 8787
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

5. **Set secrets**
```bash
fly secrets set TCL_SPECTRAL_URL=http://your-spectral:8080
fly secrets set OPENAI_API_KEY=your-key
```

6. **Deploy**
```bash
fly deploy
```

## Option 4: Docker (Any Platform)

If you prefer Docker:

1. **Create `Dockerfile`** in `packages/tcl-core`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 8787

CMD ["node", "dist/server/express.js"]
```

2. **Deploy to any Docker platform**:
   - Railway (supports Docker)
   - Render (supports Docker)
   - Fly.io (supports Docker)
   - DigitalOcean App Platform
   - AWS ECS/Fargate

## Environment Variables Reference

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | `8787` |
| `TCL_SPECTRAL_URL` | Spectral service URL | No | None |
| `OPENAI_API_KEY` | OpenAI API key | No | None |

## Testing After Deployment

1. **Check health**:
```bash
curl https://your-service-url.com/validate
```

2. **Test with a request**:
```bash
curl -X POST https://your-service-url.com/validate \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is 2+2?",
    "answer": "2+2 equals 4."
  }'
```

## Troubleshooting

### Build fails
- Check Node.js version (needs 18+)
- Verify all dependencies in `package.json`
- Check build logs

### Service won't start
- Verify `PORT` environment variable
- Check start command is correct
- Review service logs

### API not accessible
- Ensure service is publicly accessible
- Check firewall/security settings
- Verify URL is correct

### CORS errors
- Add CORS middleware to Express (if needed)
- Check that UI is calling correct URL

## Recommended Setup

For production:
1. **TCL Core** → Railway (easiest, $5/month credit)
2. **TCL UI** → Netlify (free tier)
3. **TCL Spectral** → Railway or Render (if using)

This gives you a reliable, scalable setup with minimal cost.

