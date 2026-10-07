// vite.config.js — Configuración de Vite + PWA + Vitest
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fetchBcvRates } from './api/bcvRatesHelper.js';
// Fuente única del system prompt — la misma que usa api/chat.js en Vercel.
import { CHAT_SYSTEM_PROMPT } from './src/services/chatSystemPrompt.js';

// Versión del package.json para cacheId estable (INFRA-006).
import pkg from './package.json' with { type: 'json' };
const APP_VERSION = pkg.version || '1.0.0';

export default defineConfig(({ mode }) => {
  // Cargar TODAS las variables del .env (incluyendo las sin prefijo VITE_)
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: process.env.ELECTRON_BUILD === 'true' ? './' : '/',
    plugins: [
      react(),
    VitePWA({
      registerType: 'prompt', // SW prompt: no fuerza recargas abruptas durante operaciones POS (A-001/B-003).
      includeAssets: [
        'pwa-splash-transparent-512.png',
        'transparent-splash-icon.png',
        'favicon.ico',
        'apple-touch-icon.png',
        'pwa-144x144.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-192.png',
        'pwa-maskable-512.png',
      ],
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: false, // No forzar skipWaiting automático para evitar pérdida de datos en caja.
        clientsClaim: true,
        cacheId: `preciosaldia-bodega-v${APP_VERSION}`,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/storage\/v1\/object\/public\/product-images\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images-cache',
              // OFFLINE-IMG (F2): 500 desalojaba imágenes en inventarios grandes.
              // maxAge se mantiene en 90 días a propósito: la ruta en Storage es
              // determinística con upsert, así que sin la Fase 4 una imagen
              // re-subida solo se refresca al expirar.
              expiration: { maxEntries: 1200, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // OFFLINE-IMG (F1): catálogo base servido desde public/images/catalog/.
            // NO entra al precache: el globPatterns por defecto de vite-plugin-pwa
            // no incluye .webp, y precargar los 612 archivos (23MB) al instalar
            // bloquearía la activación del SW en equipos de gama baja. Con
            // CacheFirst de runtime solo se persisten las que el negocio abre.
            // Sin regex anclado con `$`: así también matchea si algún día llega
            // con querystring.
            urlPattern: /\/images\/catalog\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'catalog-images-cache',
              // 612 archivos en el catálogo → 700 deja margen sin desalojar.
              // Son inmutables (el nombre es el slug del producto) → 1 año.
              expiration: { maxEntries: 700, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Precios Al Día — Bodegas',
        short_name: 'PreciosAlDía Bodegas',
        description: 'Punto de venta bimoneda y gestor de inventario para bodegas de Venezuela',
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        categories: ['business', 'finance', 'shopping'],
        prefer_related_applications: false,
        icons: [
          { src: 'pwa-splash-transparent-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-144x144.png', sizes: '144x144', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Vender Rápido', short_name: 'Vender', description: 'Abrir directamente el Punto de Venta', url: '/?view=ventas', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Revisar Inventario', short_name: 'Inventario', description: 'Abrir catálogo de productos', url: '/?view=catalogo', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
      },
    }),

    // ── Plugin: /api/chat dev proxy (Groq LLM — espeja api/chat.js de Vercel) ──
    // env.GROQ_KEYS viene de loadEnv() arriba — carga el .env completo en Node.
    {
      name: 'api-chat-dev',
      configureServer(server) {
        server.middlewares.use('/api/chat', (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', async () => {
            try {
              const { messages } = JSON.parse(body);
              if (!messages || !Array.isArray(messages)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "El cuerpo debe contener un arreglo 'messages'." }));
                return;
              }

              // ── Proveedor multi-tenant (OpenAI-compatible) ──
              // AI_BASE_URL  → endpoint base (default: Groq). Cualquier proveedor
              //                que hable /chat/completions estilo OpenAI sirve.
              // AI_MODEL     → modelo a usar (default: llama-3.3-70b-versatile).
              // AI_API_KEYS  → claves separadas por coma (alias retrocompatible:
              //                GROQ_KEYS sigue funcionando).
              const aiBaseUrl = (env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
              const aiModel = env.AI_MODEL || 'llama-3.3-70b-versatile';
              const aiKeysStr = env.AI_API_KEYS || env.GROQ_KEYS || '';
              const allKeys = aiKeysStr.split(',').map(k => k.trim()).filter(Boolean);
              if (allKeys.length === 0) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'AI_API_KEYS (o GROQ_KEYS) no configuradas en .env' }));
                return;
              }

              // Blindaje de paridad con producción: se descarta cualquier "system"
              // del cliente y siempre se inyecta el prompt compartido primero.
              const safeMessages = [
                { role: 'system', content: CHAT_SYSTEM_PROMPT },
                ...messages.filter(m => m && m.role !== 'system'),
              ];

              const requestBody = JSON.stringify({
                model: aiModel,
                messages: safeMessages,
                temperature: 0.7,
                max_tokens: 2048,
                stream: true,
              });

              const startIndex = Math.floor(Math.random() * allKeys.length);
              let lastError = null;
              const keyResults = [];

              for (let attempt = 0; attempt < allKeys.length; attempt++) {
                const apiKey = allKeys[(startIndex + attempt) % allKeys.length];
                let groqRes;
                try {
                  groqRes = await fetch(`${aiBaseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${apiKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: requestBody,
                  });
                  keyResults.push({ key: `...${apiKey.slice(-4)}`, code: groqRes.status });
                } catch (fetchErr) {
                  keyResults.push({ key: `...${apiKey.slice(-4)}`, code: 'network' });
                  lastError = fetchErr.message;
                  continue;
                }

                if (groqRes.status === 429 || groqRes.status === 401 || groqRes.status === 403 || groqRes.status >= 500) {
                  lastError = `Key HTTP ${groqRes.status}`;
                  continue;
                }

                if (!groqRes.ok) {
                  const errText = await groqRes.text();
                  res.statusCode = groqRes.status;
                  res.end(JSON.stringify({ error: errText }));
                  return;
                }

                // ✅ Clave ok — stream SSE de vuelta al cliente
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                const reader = groqRes.body.getReader();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(value);
                }
                res.end();
                return;
              }

              const allBlocked403 = keyResults.length > 0 && keyResults.every(r => r.code === 403);
              res.statusCode = 503;
              res.end(JSON.stringify({
                error: allBlocked403
                  ? 'Todas las claves de IA fueron rechazadas (403). La organización del proveedor parece bloqueada o suspendida — revisa la consola del proveedor o cambia AI_BASE_URL/AI_API_KEYS en .env.'
                  : 'Servicio de IA no disponible. Intenta en unos segundos.',
                detail: lastError,
                keys: keyResults,
              }));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        });
      },
    },
    // ── Plugin: /api dev endpoints (rates, search-image, image-proxy, analyze, chat) ──
    {
      name: 'api-endpoints-dev',
      configureServer(server) {
        const apiMiddleware = (req, res, next) => {
          console.log('[Dev Middleware] Request received:', req.url);
          // Lista blanca de orígenes para el dev server.
          const allowedDevOrigins = ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://localhost:4174', 'http://127.0.0.1:5174'];
          const origin = req.headers.origin;
          const corsOrigin = origin && allowedDevOrigins.includes(origin) ? origin : allowedDevOrigins[0];

          // ── /api/rates ──
          if (req.url.startsWith('/api/rates')) {
            (async () => {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', corsOrigin);
              res.setHeader('Vary', 'Origin');
              try {
                const rates = await fetchBcvRates();
                res.end(JSON.stringify({
                  bcv: { price: rates.bcv, source: `${rates.source} (USD)`, change: 0 },
                  euro: { price: rates.euro, source: `${rates.source} (EUR)`, change: 0 },
                  usdt: { price: rates.usdt, source: 'USDT Binance', change: 0 },
                  lastUpdate: new Date().toISOString(),
                }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Failed to fetch rates: ' + err.message }));
              }
            })();
            return;
          }

          // ── /api/search-image ──
          if (req.url.startsWith('/api/search-image')) {
            (async () => {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', corsOrigin);
              res.setHeader('Vary', 'Origin');

              const urlObj = new URL(req.url, `http://${req.headers.host}`);
              const query = urlObj.searchParams.get('q');

              if (!query || query.trim().length < 3) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Falta el parámetro 'q' de búsqueda (mínimo 3 caracteres)." }));
                return;
              }

              try {
                const supabaseUrl = env.VITE_SUPABASE_CLOUD_URL || env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_CLOUD_URL || process.env.VITE_SUPABASE_URL;
                const supabaseKey = env.VITE_SUPABASE_CLOUD_KEY || env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_CLOUD_KEY || process.env.VITE_SUPABASE_ANON_KEY;
                
                if (!supabaseUrl || !supabaseKey) {
                  throw new Error('Supabase URL/Key no configurada en dev .env');
                }

                const { createClient } = await import('@supabase/supabase-js');
                const supabase = createClient(supabaseUrl, supabaseKey);
                const customMappings = {
                  'TRIFOGON': 'trifogon',
                  'TOM GUAYABANA': 'dulce tom',
                  'TOM PLATANO': 'dulce tom',
                  'ALISOFT PAPEL': 'alisoft',
                  'EURO': 'papel euro',
                  'BAMBOO 4 ROLLO': 'bamboo',
                  'BAMBOO UNIDA': 'bamboo',
                  'LA PAMPA': 'pampa',
                  'AURORA SOYA': 'aurora',
                  'DOÑA TITA VINAGRE': 'dona tita',
                  'CAPRI SALSA': 'capri',
                  'KETCHUP': 'ketchup',
                  'PAZCUM SALSA': 'pazcum',
                  'SARDINES OIL': 'sardinas',
                  'TWISTI': 'twisti',
                  'MARGARINA ATUN': 'margarina',
                  'DIABLITO UNDER': 'diablito',
                  'BLANCA FLOR LEUDANTE': 'blanca flor',
                  'BLANCA FLOR TODO': 'blanca flor',
                  'KONFIT AZUCAR': 'konfit',
                  'RONCO CORTA PLUMA 500 GR': 'ronco',
                  'MARY PASTA PLUMA 500 GR': 'mary',
                  'SAN SIMON LECHE 400GR': 'san simon',
                  'ARROZ MARY SUPERIOR': 'arroz mary',
                  'ARROZ MARY PREMIUM': 'arroz mary',
                  'DOÑA BELEN': 'dona belen',
                  'PRIMOR PASTA LARGA': 'primor',
                  'MARY PASTA LARGA PREMIUM 500G': 'mary pasta',
                  'SAL PROSANCA': 'prosanca',
                  'CAFÉ LA PROTECTORA 100GR': 'protectora',
                  'CAFÉ LA PROTECTORA 200GR': 'protectora',
                  'ALIVE DETERGENTE POLVO 400GR': 'alive',
                  'AVENA 400GR GRAVENCA': 'gravenca',
                  'JUMBY RIKO': 'jumby',
                  'BUEN ARROZ 900GR': 'buen arroz',
                  'HARINA BUDARE': 'budare',
                  'HARINA MARY 900G': 'harina mary',
                  'WYNCON BUZZY': 'buzzy',
                  'JABON ANITA': 'anita',
                  'LA LLAVES JABON': 'llaves',
                  'BON BON SURTIDO': 'bon bon',
                  'CARAMELO CAFÉ': 'caramelo cafe',
                  'TOALLAS WANITA': 'wanita',
                  'PRESTOBALBA DORCO AZUL , ROSADA': 'dorco',
                  'GALLETAS MARIA ALIVAL': 'galletas maria',
                  'MIMLOT JABON': 'mimlot',
                  'MAVESA MARGARINA MANTEQUILLA': 'margarina mavesa',
                  'JUSTY DURAZNO 400L': 'justy',
                  'JUSTY MANZANA 400L': 'justy',
                  'GLUP COLA 2L': 'glup',
                  'GLUP SABORES 1L': 'glup',
                  'GLUP COLA 400L': 'glup',
                  'CIGARRO CONSUL PAQ': 'consul',
                  'CIGARRO VICEBOY PAQ': 'viceboy',
                  'CHEESKING 50G': 'cheeseking',
                  'CREMA ALIDENT AZUL': 'alident',
                  'SUAVITETWL 180ML': 'suavitel',
                  'AGUA COLL 1.5L': 'agua coll',
                  'AGUA COLL 600M': 'agua coll',
                  'GALLETA COCO RANCH': 'coco ranch',
                  'GALLETA ANIMALITOS': 'animalitos',
                  'GALLETA SODA': 'galleta soda',
                  'GALLETA CLUB SOCIAL': 'club social',
                  'LECHE DOBON 120G': 'dobon',
                  'PALITO DANIBISK': 'danibisk',
                  'FLIPS 120GR CHOCO': 'flips',
                  'FLIPS 120GR DULCE': 'flips',
                  'TIP TOP CHOCO': 'tip top',
                  'GALLETA INDEPENDENCIA': 'independencia',
                  'GALLETA DANINBISK': 'danibisk',
                  'OREO TUBO': 'oreo',
                  'RAQUETY PICANTE': 'raquety',
                  'CHEESE TRIS 4G': 'cheese tris',
                  'CHISKESITOS 45G': 'chiskesitos',
                  'TOSTON TOM 80G': 'toston tom',
                  'ESPONJA AMARILLA': 'esponja',
                  'HUEVOS TIPO A und': 'huevos',
                  'MANTEQUILLA NELLY 250G': 'nelly',
                  'MAYONESAMAVESA 500G': 'mayonesa mavesa',
                  'MAYONES MAVESA 175G': 'mayonesa mavesa',
                  'DESIFENTANTE 1LT': 'desinfectante'
                };

                const cleanText = (str) => str
                  .toLowerCase()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9\s]/g, " ")
                  .replace(/\s+/g, ' ')
                  .trim();

                const originalQuery = query.trim();
                const normalizedQuery = cleanText(originalQuery).toUpperCase();
                
                // Obtener query semántico sanitizado
                let searchQuery = customMappings[normalizedQuery] || normalizedQuery.toLowerCase();
                if (!customMappings[normalizedQuery]) {
                  let words = normalizedQuery.split(' ');
                  const noise = ['UND', 'UNIDA', 'LOTE', 'PAQ', 'PAQUE', 'PAQUETE', 'GR', 'GRS', 'KG', '1KG', '400GR', '500GR', '900G', '175G', '250G', '180ML', '200ML', '1LT', '1.5L', '2L', '1L', '400L', '600M'];
                  words = words.filter(w => !noise.includes(w) && w.length > 1);
                  searchQuery = words.length > 0 ? words[0].toLowerCase() : normalizedQuery.toLowerCase();
                }

                // Generar slug para coincidencia exacta
                const slug = searchQuery.replace(/\s+/g, '-');

                // 1. Intentar coincidencia exacta de slug
                const { data: exactMatch } = await supabase
                  .from("product_images_catalog")
                  .select("name, image_url")
                  .eq("id", slug)
                  .maybeSingle();

                if (exactMatch) {
                  res.end(JSON.stringify({
                    success: true,
                    matches: [{ title: exactMatch.name, dataUri: exactMatch.image_url }]
                  }));
                  return;
                }

                // 2. Intentar coincidencia parcial
                const words = searchQuery.split(/\s+/).filter(w => w.length > 2);
                if (words.length > 0) {
                  const { data: matches } = await supabase
                    .from("product_images_catalog")
                    .select("id, name, image_url, tags")
                    .overlaps("tags", words);

                  if (matches && matches.length > 0) {
                    const ranked = matches.map(item => {
                      let score = 0;
                      const nameLower = item.name.toLowerCase();
                      
                      // Scoring inteligente
                      words.forEach(w => {
                        if (w.length < 4) {
                          // Si es muy corta, exigir que aparezca como palabra completa delimitada (ej. "bon" en "bon bon", no "bicarbonato")
                          const regex = new RegExp(`\\b${w}\\b`, 'i');
                          if (regex.test(nameLower)) {
                            score += 10;
                            if (nameLower.startsWith(w)) score += 5;
                          }
                        } else {
                          // Para palabras de 4 o más caracteres, permitimos coincidencia parcial de subcadena
                          if (nameLower.includes(w)) {
                            score += 10;
                            if (nameLower.startsWith(w)) score += 5;
                          }
                        }
                      });


                      // Bonus por coincidencia exacta de palabras en tags
                      const itemTags = Array.isArray(item.tags) ? item.tags : [];
                      words.forEach(w => {
                        if (itemTags.includes(w)) score += 15;
                      });

                      return { ...item, score };
                    })
                    .filter(item => item.score > 0)
                    .sort((a, b) => b.score - a.score);

                    if (ranked.length > 0) {
                      const topMatches = ranked.slice(0, 5).map(item => ({
                        title: item.name,
                        dataUri: item.image_url
                      }));
                      
                      res.end(JSON.stringify({ success: true, matches: topMatches }));
                      return;
                    }
                  }
                }

                res.statusCode = 404;
                res.end(JSON.stringify({ error: "No se encontraron imágenes en el catálogo para el producto especificado." }));

              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            })();
            return;
          }

          // ── /api/image-proxy ──
          if (req.url.startsWith('/api/image-proxy')) {
            (async () => {
              res.setHeader('Access-Control-Allow-Origin', corsOrigin);
              res.setHeader('Vary', 'Origin');

              const urlObj = new URL(req.url, `http://${req.headers.host}`);
              const targetUrl = urlObj.searchParams.get('url');

              if (!targetUrl) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Falta el parámetro url.' }));
                return;
              }

              try {
                const response = await fetch(targetUrl);
                if (!response.ok) {
                  res.statusCode = response.status;
                  res.end(JSON.stringify({ error: `Error fetching target image: ${response.statusText}` }));
                  return;
                }

                const contentType = response.headers.get('Content-Type') || 'image/png';
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                res.setHeader('Content-Type', contentType);
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.end(buffer);
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            })();
            return;
          }

          // ── /api/analyze (SEC-011: CORS restringido + token efímero) ──
          if (req.url.startsWith('/api/analyze')) {
            if (req.method === 'POST') {
              // Validar origen.
              if (origin && !allowedDevOrigins.includes(origin)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ error: 'Origin not allowed' }));
                return;
              }
              // Token efímero simple para dev (no es seguridad real, solo disuasivo).
              const expectedToken = process.env.DEV_ANALYZE_TOKEN;
              if (expectedToken && req.headers['x-dev-token'] !== expectedToken) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Dev token required' }));
                return;
              }
              let body = '';
              req.on('data', (chunk) => { body += chunk; });
              req.on('end', async () => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', corsOrigin);
                res.setHeader('Vary', 'Origin');
                try {
                  const { prompt } = JSON.parse(body);
                  if (typeof prompt !== 'string' || prompt.length > 4000) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'prompt inválido o demasiado largo (máx 4000 chars)' }));
                    return;
                  }
                  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_SECONDARY;
                  if (!apiKey) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'Groq API Key not configured' }));
                    return;
                  }
                  const { default: Groq } = await import('groq-sdk');
                  const groq = new Groq({ apiKey });
                  const completion = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 300,
                    temperature: 0.3,
                  });
                  res.end(JSON.stringify({ analysis: completion.choices[0]?.message?.content || null }));
                } catch (err) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }
          }

          next();
        };

        server.middlewares.use(apiMiddleware);

        // Forzar a nuestro middleware a estar en el primer lugar de la pila
        setTimeout(() => {
          const stack = server.middlewares.stack;
          const apiIndex = stack.findIndex(m => m.handle === apiMiddleware);
          if (apiIndex > -1) {
            const [apiMiddlewareObj] = stack.splice(apiIndex, 1);
            stack.unshift(apiMiddlewareObj);
          }
        }, 100);
      },
    },
  ],

  // ── Test setup (Vitest) ──
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,jsx}'],
    exclude: ['tests/e2e/**'],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      include: ['src/utils/**', 'src/core/**'],
      exclude: ['src/**/*.jsx', 'tests/**'],
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          icons: ['lucide-react'],
          supabase: ['@supabase/supabase-js'],
          storage: ['localforage', 'zustand'],
          pdf: ['jspdf'],
          canvas: ['html2canvas'],
          // INFRA-008: separar groq-sdk y capacitor que antes se incluían en el chunk principal.
          groq: ['groq-sdk'],
        },
      },
    },
  },
  };
});
