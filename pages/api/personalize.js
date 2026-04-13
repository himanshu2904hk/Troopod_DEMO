// Simple in-memory rate limiter (basic deterrent — resets on cold start)
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

// Sanitize for HTML injection only — never sanitize before sending to AI
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function validateAdAnalysis(data) {
  if (!data || typeof data !== 'object') return false;
  return ['category','headline','tone','cta','audience','key_message','brand_name'].every(k => data[k] && typeof data[k] === 'string' && data[k].trim().length > 0);
}

function validatePersonalizedCopy(data) {
  if (!data || !data.personalized_copy) return false;
  const p = data.personalized_copy;
  return ['brand_name','hero_headline','hero_sub','cta'].every(k => p[k] && typeof p[k] === 'string' && p[k].trim().length > 0);
}

function safeParseJSON(raw) {
  const clean = raw.replace(/```json|```/g,'').trim();
  try { return JSON.parse(clean); } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
    return null;
  }
}

function extractPageSignals(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'';
  const desc = (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)||[])[1]||'';
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>m[1].replace(/<[^>]+>/g,' ').trim()).slice(0,3).join(' | ');
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m=>m[1].replace(/<[^>]+>/g,' ').trim()).slice(0,3).join(' | ');
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>m[1].replace(/<[^>]+>/g,' ').trim()).filter(t=>t.length>20).slice(0,3).join(' | ');

  const signals = `Title: ${title}\nDescription: ${desc}\nH1s: ${h1s}\nH2s: ${h2s}\nKey paragraphs: ${paras}`.slice(0,800);

  // FIX: Detect SPA empty body — warn the AI
  const isEmpty = !title && !desc && !h1s && !h2s && !paras;
  if (isEmpty) return 'Page signals are empty — this is likely a SPA that renders client-side. Infer content from the URL/domain only.';
  return signals;
}
// Enhance the REAL fetched page by injecting personalized copy
function enhanceRealPage(html, copy, baseUrl) {
  let enhanced = html;

  // Bug 3 fix: sanitize all copy values before injecting into real HTML
  const sc = (v, fallback = '') => {
    if (typeof v !== 'string') return fallback;
    return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  };

  const headline = sc(copy.hero_headline);
  const sub = sc(copy.hero_sub);
  const tagline = sc(copy.tagline);
  const cta = sc(copy.cta);
  const brandName = sc(copy.brand_name);

  // Step 1: Add <base> tag to fix ALL relative URLs in one line
  enhanced = enhanced.replace(
    /<head([^>]*)>/i,
    `<head$1><base href="${baseUrl}/">`
  );

  // Step 2: Fix remaining relative URLs explicitly
  enhanced = enhanced
    .replace(/src="\//g, `src="${baseUrl}/`)
    .replace(/href="\//g, `href="${baseUrl}/`)
    .replace(/src='\//g, `src='${baseUrl}/`)
    .replace(/href='\//g, `href='${baseUrl}/`)
    .replace(/url\(\/g, `url(${baseUrl}/`);

  // Step 3: Update <title>
  const titleRegex = new RegExp('<title[^>]*>[\s\S]*?<\/title>', 'i');
  enhanced = enhanced.replace(titleRegex, '<title>' + (brandName || 'Personalized Page') + '</title>');

  // Step 4: Update meta description
  const metaRegex = new RegExp('<meta[^>]*name=["']description["'][^>]*>', 'i');
  enhanced = enhanced.replace(metaRegex, '<meta name="description" content="' + (tagline || sub || '') + '">');

  // Step 5: Replace first <h1> content
  const h1Regex = new RegExp('(<h1[^>]*>)([\s\S]*?)(<\/h1>)', 'i');
  enhanced = enhanced.replace(h1Regex, '$1' + (headline || '') + '$3');

  // Step 6: Replace first 2 <h2> contents
  let h2Count = 0;
  const h2Regex = new RegExp('(<h2[^>]*>)([\s\S]*?)(<\/h2>)', 'gi');
  enhanced = enhanced.replace(h2Regex, (match, open, inner, close) => {
    h2Count++;
    if (h2Count === 1) return open + (sub || inner) + close;
    if (h2Count === 2) return open + (tagline || inner) + close;
    return match;
  });

  // Step 7: Replace CTA buttons
  if (cta) {
    let btnCount = 0;
    const btnRegex = new RegExp('(<button[^>]*>)([\s\S]*?)(<\/button>)', 'gi');
    enhanced = enhanced.replace(btnRegex, (match, open, inner, close) => {
      if (btnCount === 0 && inner.trim().length < 50) {
        btnCount++;
        return open + cta + close;
      }
      return match;
    });

    const ctaRegex = new RegExp('(<a[^>]*(?:btn|cta|button|primary)[^>]*>)([\s\S]*?)(<\/a>)', 'i');
    enhanced = enhanced.replace(ctaRegex, '$1' + cta + '$3');
  }

  // Step 8: Add personalization banner
  const banner = `<div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#7F77DD;color:white;text-align:center;padding:10px 16px;font-family:sans-serif;font-size:13px;font-weight:500;">
    ✨ Personalized by Troopod AI — copy rewritten to match your ad creative
    <span style="margin-left:16px;opacity:0.8;font-size:11px;">Original: ${baseUrl}</span>
  </div>`;
  enhanced = enhanced.replace('</body>', `${banner}</body>`);

  return enhanced;
}



export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });

  const { ad_description, ad_image_url, landing_page_url } = req.body;
  if (!ad_description && !ad_image_url) return res.status(400).json({ error: 'Please describe your ad or provide an image URL.' });
  if (!landing_page_url) return res.status(400).json({ error: 'Please enter a landing page URL.' });
  try { new URL(landing_page_url); } catch { return res.status(400).json({ error: 'Please enter a valid URL.' }); }

  const imagePool = {
    food: ['https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&q=80','https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1600&q=80','https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1600&q=80'],
    fitness: ['https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1600&q=80','https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1600&q=80','https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1600&q=80'],
    tech: ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=1600&q=80','https://images.unsplash.com/photo-1580910051074-3eb694886505?w=1600&q=80','https://images.unsplash.com/photo-1518770660439-4636190af475?w=1600&q=80'],
    fashion: ['https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600&q=80','https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1600&q=80'],
    travel: ['https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1600&q=80','https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80'],
    beauty: ['https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1600&q=80','https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1600&q=80'],
    automotive: ['https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1600&q=80','https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=1600&q=80'],
    finance: ['https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&q=80','https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=1600&q=80'],
    education: ['https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1600&q=80','https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=1600&q=80'],
    luxury: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1600&q=80','https://images.unsplash.com/photo-1547996160-81dfa63595aa?w=1600&q=80','https://images.unsplash.com/photo-1614164185128-e4ec99c436d7?w=1600&q=80'],
    default: ['https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80','https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=1600&q=80']
  };

  const brandColors = { food:'#E23744', fitness:'#111111', tech:'#0071e3', fashion:'#1a1a1a', travel:'#0077b6', beauty:'#c77dff', automotive:'#d62828', finance:'#2d6a4f', education:'#3a86ff', luxury:'#b8960c', default:'#6366f1' };
  const brandLights = { food:'#fff1f2', fitness:'#f9fafb', tech:'#f0f4ff', fashion:'#f9f9f9', travel:'#e0f4ff', beauty:'#f9f0ff', automotive:'#fff0f0', finance:'#f0fff4', education:'#f0f4ff', luxury:'#fdfaf0', default:'#eef2ff' };

  // FIX: Run landing page fetch and nothing else in parallel with Call 1
  // Fetch landing page
  let pageSignals = '';
  let fetchSuccess = false;

  let rawHtml = '';

  const fetchPage = async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const lpRes = await fetch(landing_page_url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html' }
      });
      clearTimeout(timeout);
      const html = await lpRes.text();
      fetchSuccess = true;
      rawHtml = html; // Store raw HTML for enhancement
      return extractPageSignals(html);
    } catch(e) {
      try { const domain = new URL(landing_page_url).hostname.replace('www.',''); return `Brand: ${domain}`; } catch { return landing_page_url; }
    }
  };

  // Use raw ad text for AI — sanitize only before HTML injection
  const adInput = ad_description || '';
  const imageContext = ad_image_url ? `\nAd image URL: ${ad_image_url}` : '';

  async function groqCall(messages, maxTokens, temperature, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, temperature, messages })
      });
      clearTimeout(timeout);
      return r;
    } catch(e) { clearTimeout(timeout); throw new Error('Request timed out. Please try again.'); }
  }

  try {
    // Sequential: fetch page first so Call 1 has full context for accurate category detection
    pageSignals = await fetchPage();

    const call1Res = await groqCall([{
      role: 'user',
      content: `Analyze this ad creative and landing page context. Return ONLY valid JSON, no markdown.

Ad: ${adInput}${imageContext}

Landing page signals:
${pageSignals}

Return this JSON with NO empty values:
{
  "category": "one category from the list below",
  "headline": "the main headline or hook in the ad",
  "tone": "one of: urgent, aspirational, playful, professional, emotional, educational, provocative, minimal, luxurious",
  "cta": "the call to action text",
  "audience": "who this ad targets — be specific (age, intent, pain point)",
  "key_message": "the single core promise in one sentence",
  "brand_name": "brand being advertised"
}

Category rules (check in order, pick FIRST match):
1. luxury = high-end watches, jewelry, Rolex, Omega, Louis Vuitton, Hermès, premium spirits, items $500+
2. automotive = cars, motorcycles, EVs, dealerships, auto parts, car insurance
3. finance = banking, investing, crypto, insurance, credit cards, loans, fintech
4. tech = phones, laptops, software, SaaS, apps, AI tools, gadgets
5. fitness = gym, workout, sports gear, supplements, Nike/Adidas athletic
6. beauty = skincare, makeup, haircare, cosmetics, fragrance (NOT luxury jewelry)
7. fashion = clothing, shoes, accessories, streetwear (NOT luxury watches)
8. food = restaurants, meal delivery, cooking, grocery, beverages
9. travel = flights, hotels, vacation, Airbnb, tourism
10. education = courses, bootcamps, universities, tutoring, e-learning
11. default = anything else

If it fits multiple categories, pick based on the PRIMARY product being sold.`
    }], 300, 0.3, 10000);

    // Validate Call 1
    const call1Data = await call1Res.json();
    if (!call1Res.ok) {
      console.error('[Call 1 API error]', call1Data);
      throw new Error('Could not analyze the ad creative. Please try again.');
    }

    let adAnalysis = safeParseJSON(call1Data.choices?.[0]?.message?.content || '');

    // Retry Call 1 if invalid
    if (!validateAdAnalysis(adAnalysis)) {
      console.error('[Call 1 validation failed]', adAnalysis);
      const retryRes = await groqCall([{
        role: 'user',
        content: `Analyze this ad and return ONLY valid JSON with all fields filled.
Ad: ${adInput}${imageContext}
Landing page URL: ${landing_page_url}
{ "category": "...", "headline": "...", "tone": "...", "cta": "...", "audience": "...", "key_message": "...", "brand_name": "..." }`
      }], 300, 0.3, 10000);
      const retryData = await retryRes.json();
      adAnalysis = safeParseJSON(retryData.choices?.[0]?.message?.content || '');
      if (!validateAdAnalysis(adAnalysis)) {
        return res.status(500).json({ error: 'Could not analyze the ad creative. Please try a more detailed description.' });
      }
    }

    // Call 2: Generate copy using verified analysis + page signals
    const call2Res = await groqCall([{
      role: 'user',
      content: `You are a CRO copywriter. Rewrite landing page copy to perfectly match an ad creative. Return ONLY valid JSON, no markdown.

AD ANALYSIS:
- Brand: ${adAnalysis.brand_name}
- Headline: ${adAnalysis.headline}
- Tone: ${adAnalysis.tone}
- CTA: ${adAnalysis.cta}
- Audience: ${adAnalysis.audience}
- Key message: ${adAnalysis.key_message}
- Category: ${adAnalysis.category}

CURRENT PAGE:
${pageSignals}

COPY RULES:
- Hero headline: max 10 words, must echo the ad's key_message so visitors instantly feel "this is what I clicked for"
- Subheadline: max 25 words, add proof or specificity (not a repeat of headline)
- CTA: max 5 words, specific action verb. Never "Learn More" or "Get Started" unless the ad used those words
- Stats: values must be short numbers like "500+", "4.9★", "24/7", "2.4x", "11 min" — never sentences. Labels: 2-3 words max
- Features: connect each feature to the ad's promise, don't just describe product specs
- Testimonials: must sound like real speech with specific details. Include realistic name + role. Bad: "Exceeded expectations." Good: "Switched last month and already saving 3 hours a week."

TONE GUIDE:
- If luxurious: use "crafted", "timeless", "distinguished", "legacy", "atelier"
- If urgent: use "limited", "today only", "don't miss", "ending soon", "act now"
- If playful: use contractions, light humor, conversational language
- If professional: use clean, precise language, data-driven claims
- If aspirational: use "elevate", "transform", "unlock", "imagine", "future"

Return ALL fields filled:
{
  "original_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },
  "personalized_copy": {
    "brand_name": "...", "tagline": "max 8 words", "hero_headline": "max 10 words", "hero_sub": "max 25 words", "cta": "max 5 words",
    "stat_1_value": "...", "stat_1_label": "2-3 words",
    "stat_2_value": "...", "stat_2_label": "2-3 words",
    "stat_3_value": "...", "stat_3_label": "2-3 words",
    "feature_1_icon": "emoji", "feature_1_title": "...", "feature_1_desc": "one sentence",
    "feature_2_icon": "emoji", "feature_2_title": "...", "feature_2_desc": "one sentence",
    "feature_3_icon": "emoji", "feature_3_title": "...", "feature_3_desc": "one sentence",
    "testimonial_1": "max 20 words, natural speech", "testimonial_1_name": "First L.", "testimonial_1_role": "specific role",
    "testimonial_2": "max 20 words, natural speech", "testimonial_2_name": "First L.", "testimonial_2_role": "specific role"
  },
  "changes": ["what changed + why it improves conversion", "...", "...", "...", "..."]
}`
    }], 1200, 0.7, 15000);

    const call2Data = await call2Res.json();
    if (!call2Res.ok) {
      console.error('[Call 2 API error]', call2Data);
      throw new Error('Could not generate personalized copy. Please try again.');
    }

    let copyData = safeParseJSON(call2Data.choices?.[0]?.message?.content || '');

    if (!validatePersonalizedCopy(copyData)) {
      console.error('[Call 2 validation failed]', copyData);
      return res.status(500).json({ error: 'Could not generate personalized copy. Please try again.' });
    }

    const category = imagePool[adAnalysis.category] ? adAnalysis.category : 'default';
    const images = imagePool[category];
    const heroImage = images[Math.floor(Math.random() * images.length)];
    const brandColor = brandColors[category] || '#6366f1';
    const brandLight = brandLights[category] || '#eef2ff';
    const p = copyData.personalized_copy;
    const year = new Date().getFullYear();
    const s = (v, fallback='') => sanitize(v || fallback);

    const personalizedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${s(p.brand_name,'Personalized Page')}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;color:#1a1a1a}
nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(255,255,255,0.96);backdrop-filter:blur(10px);padding:16px 48px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f0f0f0}
nav .logo{font-size:22px;font-weight:800;color:${brandColor}}
nav .nav-cta{background:${brandColor};color:white;padding:10px 24px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none}
.hero{min-height:100vh;background:linear-gradient(135deg,rgba(0,0,0,0.7) 0%,rgba(0,0,0,0.4) 100%),url('${heroImage}') center/cover no-repeat;display:flex;align-items:center;justify-content:center;text-align:center;padding:120px 24px 80px}
.hero-content{max-width:820px}
.hero h1{font-size:clamp(40px,7vw,80px);font-weight:900;color:white;line-height:1.05;margin-bottom:24px;letter-spacing:-1px;text-shadow:0 2px 20px rgba(0,0,0,0.3)}
.hero p{font-size:clamp(16px,2.5vw,22px);color:rgba(255,255,255,0.88);margin-bottom:44px;line-height:1.6}
.hero-btns{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.btn-primary{background:${brandColor};color:white;padding:16px 40px;border-radius:10px;border:none;font-size:16px;font-weight:700;cursor:pointer;text-decoration:none;transition:transform 0.2s,opacity 0.2s;display:inline-block}
.btn-primary:hover{opacity:0.9;transform:translateY(-2px)}
.btn-secondary{background:transparent;color:white;padding:16px 40px;border-radius:10px;border:2px solid rgba(255,255,255,0.8);font-size:16px;font-weight:600;cursor:pointer;text-decoration:none;transition:all 0.2s;display:inline-block}
.btn-secondary:hover{background:white;color:#1a1a1a}
.stats{background:${brandColor};padding:36px 48px;display:flex;justify-content:center;gap:80px;flex-wrap:wrap}
.stat{text-align:center;color:white}.stat-num{font-size:34px;font-weight:900}.stat-label{font-size:13px;opacity:0.8;margin-top:6px;text-transform:uppercase;letter-spacing:0.05em}
.features{padding:100px 48px;background:white}.features-title{text-align:center;font-size:40px;font-weight:800;margin-bottom:16px}.features-sub{text-align:center;font-size:18px;color:#666;margin-bottom:64px}
.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:28px;max-width:1100px;margin:0 auto}
.feature-card{background:${brandLight};border-radius:20px;padding:40px 32px;transition:transform 0.3s,box-shadow 0.3s}.feature-card:hover{transform:translateY(-8px);box-shadow:0 24px 48px rgba(0,0,0,0.1)}
.feature-icon{font-size:48px;margin-bottom:20px}.feature-card h3{font-size:20px;font-weight:700;margin-bottom:12px}.feature-card p{font-size:15px;color:#555;line-height:1.7}
.testimonials{background:#f8f9fa;padding:100px 48px}.testimonials h2{text-align:center;font-size:36px;font-weight:800;margin-bottom:64px}
.testimonials-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:28px;max-width:900px;margin:0 auto}
.testimonial-card{background:white;border-radius:20px;padding:36px;box-shadow:0 4px 24px rgba(0,0,0,0.06)}
.stars{color:#f59e0b;font-size:22px;margin-bottom:16px}.testimonial-card p{font-size:15px;color:#444;line-height:1.8;margin-bottom:24px;font-style:italic}
.reviewer{display:flex;align-items:center;gap:12px}.avatar{width:46px;height:46px;border-radius:50%;background:${brandColor};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:16px;flex-shrink:0}
.reviewer-info .name{font-weight:700;font-size:14px}.reviewer-info .role{font-size:12px;color:#888;margin-top:2px}
.cta-section{background:${brandColor};padding:100px 48px;text-align:center}.cta-section h2{font-size:44px;font-weight:900;color:white;margin-bottom:16px}.cta-section p{font-size:18px;color:rgba(255,255,255,0.85);margin-bottom:44px}
.btn-white{background:white;color:${brandColor};padding:18px 52px;border-radius:10px;border:none;font-size:18px;font-weight:700;cursor:pointer;text-decoration:none;transition:transform 0.2s;display:inline-block}.btn-white:hover{transform:translateY(-2px)}
footer{background:#111;color:white;padding:48px;text-align:center}.footer-logo{font-size:22px;font-weight:800;color:${brandColor};margin-bottom:8px}footer p{font-size:14px;color:#666;margin-top:4px}
</style>
</head>
<body>
<nav><div class="logo">${s(p.brand_name,'Brand')}</div><a href="#" class="nav-cta">${s(p.cta,'Get Started')}</a></nav>
<section class="hero">
  <div class="hero-content">
    <h1>${s(p.hero_headline,'Welcome')}</h1>
    <p>${s(p.hero_sub)}</p>
    <div class="hero-btns">
      <a href="#" class="btn-primary">${s(p.cta,'Get Started')}</a>
      <a href="#" class="btn-secondary">Learn More</a>
    </div>
  </div>
</section>
<section class="stats">
  <div class="stat"><div class="stat-num">${s(p.stat_1_value,'100+')}</div><div class="stat-label">${s(p.stat_1_label,'Years')}</div></div>
  <div class="stat"><div class="stat-num">${s(p.stat_2_value,'500+')}</div><div class="stat-label">${s(p.stat_2_label,'Customers')}</div></div>
  <div class="stat"><div class="stat-num">${s(p.stat_3_value,'99%')}</div><div class="stat-label">${s(p.stat_3_label,'Satisfaction')}</div></div>
</section>
<section class="features">
  <div class="features-title">Why Choose Us</div>
  <div class="features-sub">${s(p.tagline)}</div>
  <div class="features-grid">
    <div class="feature-card"><div class="feature-icon">${s(p.feature_1_icon,'⚡')}</div><h3>${s(p.feature_1_title,'Feature 1')}</h3><p>${s(p.feature_1_desc)}</p></div>
    <div class="feature-card"><div class="feature-icon">${s(p.feature_2_icon,'🎯')}</div><h3>${s(p.feature_2_title,'Feature 2')}</h3><p>${s(p.feature_2_desc)}</p></div>
    <div class="feature-card"><div class="feature-icon">${s(p.feature_3_icon,'💎')}</div><h3>${s(p.feature_3_title,'Feature 3')}</h3><p>${s(p.feature_3_desc)}</p></div>
  </div>
</section>
<section class="testimonials">
  <h2>What Our Customers Say</h2>
  <div class="testimonials-grid">
    <div class="testimonial-card">
      <div class="stars">★★★★★</div>
      <p>"${s(p.testimonial_1,'Amazing experience!')}"</p>
      <div class="reviewer"><div class="avatar">${s(p.testimonial_1_name,'A')[0]}</div><div class="reviewer-info"><div class="name">${s(p.testimonial_1_name,'Customer')}</div><div class="role">${s(p.testimonial_1_role,'Verified Customer')}</div></div></div>
    </div>
    <div class="testimonial-card">
      <div class="stars">★★★★★</div>
      <p>"${s(p.testimonial_2,'Highly recommended!')}"</p>
      <div class="reviewer"><div class="avatar">${s(p.testimonial_2_name,'S')[0]}</div><div class="reviewer-info"><div class="name">${s(p.testimonial_2_name,'Customer')}</div><div class="role">${s(p.testimonial_2_role,'Verified Customer')}</div></div></div>
    </div>
  </div>
</section>
<section class="cta-section">
  <h2>${s(p.hero_headline,'Ready?')}</h2>
  <p>${s(p.tagline||p.hero_sub)}</p>
  <a href="#" class="btn-white">${s(p.cta,'Get Started Now')}</a>
</section>
<footer>
  <div class="footer-logo">${s(p.brand_name,'Brand')}</div>
  <p>${s(p.tagline)}</p>
  <p style="margin-top:12px;color:#444">© ${year} ${s(p.brand_name,'Brand')}. All rights reserved.</p>
</footer>
</body>
</html>`;

    // Use real page enhancement if we got actual HTML content
    let finalHtml = personalizedHtml;
    let enhanced = false;

    if (fetchSuccess && rawHtml && rawHtml.length > 500) {
      // Bug 1 fix: reuse existing pageSignals instead of calling extractPageSignals again
      const isSPA = pageSignals.includes('Page signals are empty');
      if (!isSPA) {
        finalHtml = enhanceRealPage(rawHtml, p, new URL(landing_page_url).origin);
        enhanced = true;
      }
    }

    return res.status(200).json({
      ad_analysis: adAnalysis,
      original_copy: copyData.original_copy,
      personalized_copy: copyData.personalized_copy,
      personalized_html: finalHtml,
      changes: copyData.changes,
      fetch_success: fetchSuccess,
      enhanced,
      category
    });

  } catch(err) {
    console.error('[personalize error]', err.message);
    return res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
  }
}
