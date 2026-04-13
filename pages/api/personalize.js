// Rate limiter
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > 60000) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= 5) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function validateAdAnalysis(data) {
  if (!data || typeof data !== 'object') return false;
  return ['category','headline','tone','cta','audience','key_message','brand_name'].every(k => data[k] && data[k].trim().length > 0);
}

function validatePersonalizedCopy(data) {
  if (!data || !data.personalized_copy) return false;
  const p = data.personalized_copy;
  return ['brand_name','hero_headline','hero_sub','cta'].every(k => p[k] && p[k].trim().length > 0);
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
  const isEmpty = !title && !desc && !h1s && !h2s && !paras;
  if (isEmpty) return 'Page signals empty — SPA or blocked. Infer from domain only.';
  return ('Title: ' + title + '\nDescription: ' + desc + '\nH1s: ' + h1s + '\nH2s: ' + h2s + '\nKey paragraphs: ' + paras).slice(0,800);
}

// Enhance the REAL fetched page by injecting personalized copy
function enhanceRealPage(html, copy, baseUrl) {
  let enhanced = html;

  // Sanitize copy values before injecting into real HTML
  const sc = (v, fallback) => {
    const str = v || fallback || '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
  };

  const headline = sc(copy.hero_headline);
  const sub = sc(copy.hero_sub);
  const tagline = sc(copy.tagline);
  const cta = sc(copy.cta);
  const brandName = sc(copy.brand_name);

  // Add <base> tag to fix relative URLs in one line
  enhanced = enhanced.replace(/<head([^>]*)>/i, '<head$1><base href="' + baseUrl + '/">');

  // Fix remaining relative URLs
  enhanced = enhanced
    .replace(/src="\//g, 'src="' + baseUrl + '/')
    .replace(/href="\//g, 'href="' + baseUrl + '/')
    .replace(/src='\//g, "src='" + baseUrl + '/')
    .replace(/href='\//g, "href='" + baseUrl + '/')
    .replace(/url\(\//g, 'url(' + baseUrl + '/');

  // Update <title>
  const titleRegex = new RegExp('<title[^>]*>[\s\S]*?<\/title>', 'i');
  enhanced = enhanced.replace(titleRegex, '<title>' + (brandName || 'Personalized Page') + '</title>');

  // Update meta description
  const metaRegex = /<meta[^>]*name=["']description["'][^>]*>/i;
  enhanced = enhanced.replace(metaRegex, '<meta name="description" content="' + (tagline || sub || '') + '">');

  // Replace first <h1>
  const h1Regex = new RegExp('(<h1[^>]*>)([\s\S]*?)(<\/h1>)', 'i');
  enhanced = enhanced.replace(h1Regex, '$1' + (headline || '') + '$3');

  // Replace first 2 <h2>s
  let h2Count = 0;
  const h2Regex = new RegExp('(<h2[^>]*>)([\s\S]*?)(<\/h2>)', 'gi');
  enhanced = enhanced.replace(h2Regex, (match, open, inner, close) => {
    h2Count++;
    if (h2Count === 1) return open + (sub || inner) + close;
    if (h2Count === 2) return open + (tagline || inner) + close;
    return match;
  });

  // Replace first CTA button
  if (cta) {
    let btnCount = 0;
    const btnRegex = new RegExp('(<button[^>]*>)([\s\S]*?)(<\/button>)', 'gi');
    enhanced = enhanced.replace(btnRegex, (match, open, inner, close) => {
      if (btnCount === 0 && inner.trim().length < 50) { btnCount++; return open + cta + close; }
      return match;
    });
    const ctaRegex = new RegExp('(<a[^>]*(?:btn|cta|button|primary)[^>]*>)([\s\S]*?)(<\/a>)', 'i');
    enhanced = enhanced.replace(ctaRegex, '$1' + cta + '$3');
  }

  // Add personalization banner
  const bannerStyle = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#7F77DD;color:white;text-align:center;padding:10px 16px;font-family:sans-serif;font-size:13px;font-weight:500;';
  const spanStyle = 'margin-left:16px;opacity:0.8;font-size:11px;';
  const banner = '<div style="' + bannerStyle + '">✨ Personalized by Troopod AI — copy rewritten to match your ad creative<span style="' + spanStyle + '">Original: ' + baseUrl + '</span></div>';
  enhanced = enhanced.replace('</body>', banner + '</body>');

  return enhanced;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });

  const { ad_description, ad_image_url, landing_page_url } = req.body;
  if (!ad_description && !ad_image_url) return res.status(400).json({ error: 'Please describe your ad.' });
  if (!landing_page_url) return res.status(400).json({ error: 'Please enter a landing page URL.' });
  try { new URL(landing_page_url); } catch { return res.status(400).json({ error: 'Please enter a valid URL.' }); }

  // Fetch landing page
  let pageSignals = '';
  let fetchSuccess = false;
  let rawHtml = '';

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
    rawHtml = html;
    pageSignals = extractPageSignals(html);
  } catch(e) {
    try { pageSignals = 'Brand: ' + new URL(landing_page_url).hostname.replace('www.',''); } catch { pageSignals = landing_page_url; }
  }

  const adInput = ad_description || '';
  const imageContext = ad_image_url ? '\nAd image URL: ' + ad_image_url : '';

  async function groqCall(messages, maxTokens, temperature, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, temperature, messages })
      });
      clearTimeout(timeout);
      return r;
    } catch(e) { clearTimeout(timeout); throw new Error('Request timed out. Please try again.'); }
  }

  try {
    // CALL 1: Analyze ad + page context
    let adAnalysis = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await groqCall([{
        role: 'user',
        content: 'Analyze this ad creative and landing page. Return ONLY valid JSON.\n\nAd: ' + adInput + imageContext + '\n\nLanding page URL: ' + landing_page_url + '\nPage signals: ' + pageSignals + '\n\nReturn this JSON:\n{\n  "category": "food|fitness|tech|fashion|travel|beauty|automotive|finance|education|luxury|default",\n  "headline": "main ad headline",\n  "tone": "one of: urgent|aspirational|playful|professional|emotional|luxurious|minimal",\n  "cta": "call to action",\n  "audience": "target audience",\n  "key_message": "core promise in one sentence",\n  "brand_name": "brand being advertised",\n  "target_brand": "brand of the landing page URL",\n  "target_primary_color": "best guess hex color for the landing page brand e.g. #E23744 for Swiggy",\n  "target_bg_color": "best guess background hex color e.g. #FFFFFF"\n}\n\nCategory rules:\n1. luxury = watches jewelry Rolex premium brands\n2. automotive = cars EVs dealerships\n3. finance = banking investing fintech\n4. tech = phones laptops software apps\n5. fitness = gym sports Nike Adidas\n6. beauty = skincare makeup cosmetics\n7. fashion = clothes shoes streetwear\n8. food = restaurants delivery cooking\n9. travel = flights hotels vacation\n10. education = courses universities\n11. default = anything else'
      }], 400, 0.3, 10000);

      const data = await r.json();
      if (!r.ok) { console.error('[Call 1 error]', data); break; }
      const parsed = safeParseJSON(data.choices?.[0]?.message?.content || '');
      if (validateAdAnalysis(parsed)) { adAnalysis = parsed; break; }
      if (attempt === 2) return res.status(500).json({ error: 'Could not analyze the ad. Please try a more detailed description.' });
    }

    // CALL 2: Generate personalized copy
    let copyData = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await groqCall([{
        role: 'user',
        content: 'You are a CRO copywriter. Generate personalized landing page copy. Return ONLY valid JSON.\n\nAD ANALYSIS:\n- Ad Brand: ' + adAnalysis.brand_name + '\n- Target Page Brand: ' + adAnalysis.target_brand + '\n- Headline: ' + adAnalysis.headline + '\n- Tone: ' + adAnalysis.tone + '\n- CTA: ' + adAnalysis.cta + '\n- Audience: ' + adAnalysis.audience + '\n- Key message: ' + adAnalysis.key_message + '\n- Category: ' + adAnalysis.category + '\n\nLANDING PAGE: ' + pageSignals + '\n\nCOPY RULES:\n- Hero headline: max 10 words, echo the ad key_message\n- Subheadline: max 25 words, add proof or specificity\n- CTA: max 5 words, specific action verb\n- Stats: short numbers like "500+" "4.9★" "30 min" with 2-3 word labels\n- Features: connect to ad promise not product specs\n- Testimonials: natural speech with specific details\n\nTONE GUIDE:\n- luxurious: use crafted timeless distinguished legacy\n- urgent: use limited today only act now\n- playful: contractions humor conversational\n- aspirational: elevate transform unlock imagine\n\nReturn ALL fields:\n{\n  "original_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },\n  "personalized_copy": {\n    "brand_name": "...", "tagline": "max 8 words", "hero_headline": "max 10 words", "hero_sub": "max 25 words", "cta": "max 5 words",\n    "stat_1_value": "...", "stat_1_label": "2-3 words",\n    "stat_2_value": "...", "stat_2_label": "2-3 words",\n    "stat_3_value": "...", "stat_3_label": "2-3 words",\n    "feature_1_icon": "emoji", "feature_1_title": "...", "feature_1_desc": "one sentence",\n    "feature_2_icon": "emoji", "feature_2_title": "...", "feature_2_desc": "one sentence",\n    "feature_3_icon": "emoji", "feature_3_title": "...", "feature_3_desc": "one sentence",\n    "testimonial_1": "natural speech max 20 words", "testimonial_1_name": "First L.", "testimonial_1_role": "specific role",\n    "testimonial_2": "natural speech max 20 words", "testimonial_2_name": "First L.", "testimonial_2_role": "specific role"\n  },\n  "changes": ["what changed + why it improves conversion", "...", "...", "...", "..."]\n}'
      }], 1200, 0.7, 15000);

      const data = await r.json();
      if (!r.ok) { console.error('[Call 2 error]', data); break; }
      const parsed = safeParseJSON(data.choices?.[0]?.message?.content || '');
      if (validatePersonalizedCopy(parsed)) { copyData = parsed; break; }
      if (attempt === 2) return res.status(500).json({ error: 'Could not generate copy. Please try again.' });
    }

    const p = copyData.personalized_copy;
    const s = (v, fallback) => sanitize(v || fallback || '');

    // Use AI-detected brand colors or category defaults
    const categoryColors = {
      food: '#E23744', fitness: '#111111', tech: '#0071e3', fashion: '#1a1a1a',
      travel: '#0077b6', beauty: '#c77dff', automotive: '#d62828', finance: '#2d6a4f',
      education: '#3a86ff', luxury: '#b8960c', default: '#6366f1'
    };
    const categoryImages = {
      food: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&q=80',
      fitness: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1600&q=80',
      tech: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=1600&q=80',
      fashion: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600&q=80',
      travel: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1600&q=80',
      beauty: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1600&q=80',
      automotive: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1600&q=80',
      finance: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&q=80',
      education: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1600&q=80',
      luxury: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1600&q=80',
      default: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80'
    };

    const category = adAnalysis.category || 'default';
    // Use AI-detected target brand color, fall back to category color
    const primaryColor = adAnalysis.target_primary_color || categoryColors[category] || '#6366f1';
    const heroImage = categoryImages[category] || categoryImages.default;
    const year = new Date().getFullYear();

    // Build the personalized page that LOOKS like the target brand
    const personalizedHtml = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>' + s(p.brand_name,'Page') + ' — ' + s(p.hero_headline,'Personalized') + '</title>\n<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:\'Inter\',sans-serif;color:#1a1a1a;background:#fff}\nnav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(255,255,255,0.97);backdrop-filter:blur(12px);padding:0 48px;height:64px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f0f0f0;box-shadow:0 1px 3px rgba(0,0,0,0.05)}\n.nav-logo{font-size:20px;font-weight:800;color:' + primaryColor + ';letter-spacing:-0.5px}\n.nav-links{display:flex;gap:32px}\n.nav-links a{font-size:14px;color:#444;text-decoration:none;font-weight:500}\n.nav-links a:hover{color:' + primaryColor + '}\n.nav-cta{background:' + primaryColor + ';color:white;padding:10px 22px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;transition:opacity 0.2s}\n.nav-cta:hover{opacity:0.88}\n.hero{min-height:100vh;background:linear-gradient(150deg,rgba(0,0,0,0.72) 0%,rgba(0,0,0,0.35) 100%),url(\'' + heroImage + '\') center/cover no-repeat;display:flex;align-items:center;justify-content:flex-start;padding:100px 80px 80px}\n.hero-content{max-width:680px}\n.hero-badge{display:inline-block;background:rgba(255,255,255,0.15);color:white;font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;border:1px solid rgba(255,255,255,0.3);margin-bottom:24px;backdrop-filter:blur(4px)}\n.hero h1{font-size:clamp(42px,6vw,76px);font-weight:900;color:white;line-height:1.05;margin-bottom:20px;letter-spacing:-1.5px}\n.hero-sub{font-size:clamp(16px,2vw,20px);color:rgba(255,255,255,0.85);margin-bottom:40px;line-height:1.65;max-width:540px}\n.hero-btns{display:flex;gap:14px;flex-wrap:wrap}\n.btn-p{background:' + primaryColor + ';color:white;padding:15px 36px;border-radius:9px;border:none;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;transition:transform 0.2s,opacity 0.2s}\n.btn-p:hover{opacity:0.9;transform:translateY(-1px)}\n.btn-s{background:rgba(255,255,255,0.1);color:white;padding:15px 36px;border-radius:9px;border:1.5px solid rgba(255,255,255,0.5);font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block;transition:all 0.2s;backdrop-filter:blur(4px)}\n.btn-s:hover{background:rgba(255,255,255,0.2)}\n.stats{background:' + primaryColor + ';padding:28px 80px;display:flex;justify-content:center;gap:80px;flex-wrap:wrap}\n.stat{text-align:center;color:white}\n.stat-v{font-size:32px;font-weight:900;letter-spacing:-0.5px}\n.stat-l{font-size:12px;opacity:0.78;margin-top:5px;text-transform:uppercase;letter-spacing:0.06em}\n.features{padding:96px 80px;background:#fff}\n.section-label{text-align:center;font-size:13px;font-weight:600;color:' + primaryColor + ';text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px}\n.section-title{text-align:center;font-size:38px;font-weight:800;margin-bottom:12px;letter-spacing:-0.5px}\n.section-sub{text-align:center;font-size:17px;color:#666;margin-bottom:60px;max-width:540px;margin-left:auto;margin-right:auto}\n.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;max-width:1080px;margin:0 auto}\n.fc{background:#f8f9fa;border-radius:16px;padding:36px 28px;transition:transform 0.25s,box-shadow 0.25s;border:1px solid #f0f0f0}\n.fc:hover{transform:translateY(-6px);box-shadow:0 20px 40px rgba(0,0,0,0.08)}\n.fc-icon{font-size:44px;margin-bottom:16px}\n.fc h3{font-size:18px;font-weight:700;margin-bottom:10px}\n.fc p{font-size:14px;color:#555;line-height:1.7}\n.social-proof{background:#f8f9fa;padding:96px 80px;border-top:1px solid #eee}\n.testimonials-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;max-width:880px;margin:0 auto}\n.tc{background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 16px rgba(0,0,0,0.06);border:1px solid #f0f0f0}\n.stars{color:#f59e0b;font-size:18px;letter-spacing:2px;margin-bottom:14px}\n.tc-quote{font-size:15px;color:#333;line-height:1.75;margin-bottom:20px;font-style:italic}\n.reviewer{display:flex;align-items:center;gap:12px}\n.avatar{width:42px;height:42px;border-radius:50%;background:' + primaryColor + ';display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:15px;flex-shrink:0}\n.r-name{font-weight:700;font-size:14px}\n.r-role{font-size:12px;color:#888;margin-top:2px}\n.cta-band{background:' + primaryColor + ';padding:96px 80px;text-align:center}\n.cta-band h2{font-size:42px;font-weight:900;color:white;margin-bottom:14px;letter-spacing:-1px}\n.cta-band p{font-size:17px;color:rgba(255,255,255,0.82);margin-bottom:40px;max-width:480px;margin-left:auto;margin-right:auto}\n.btn-w{background:white;color:' + primaryColor + ';padding:16px 48px;border-radius:9px;border:none;font-size:17px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;transition:transform 0.2s}\n.btn-w:hover{transform:translateY(-2px)}\nfooter{background:#0f0f0f;padding:48px 80px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}\n.footer-logo{font-size:18px;font-weight:800;color:' + primaryColor + '}\n.footer-copy{font-size:13px;color:#555}\n</style>\n</head>\n<body>\n<nav>\n  <div class="nav-logo">' + s(p.brand_name,'Brand') + '</div>\n  <div class="nav-links">\n    <a href="#">Features</a>\n    <a href="#">Pricing</a>\n    <a href="#">About</a>\n  </div>\n  <a href="#" class="nav-cta">' + s(p.cta,'Get Started') + '</a>\n</nav>\n\n<section class="hero">\n  <div class="hero-content">\n    <div class="hero-badge">' + s(adAnalysis.key_message,'') + '</div>\n    <h1>' + s(p.hero_headline,'Welcome') + '</h1>\n    <p class="hero-sub">' + s(p.hero_sub,'') + '</p>\n    <div class="hero-btns">\n      <a href="#" class="btn-p">' + s(p.cta,'Get Started') + '</a>\n      <a href="#" class="btn-s">Learn More</a>\n    </div>\n  </div>\n</section>\n\n<section class="stats">\n  <div class="stat"><div class="stat-v">' + s(p.stat_1_value,'10x') + '</div><div class="stat-l">' + s(p.stat_1_label,'Better') + '</div></div>\n  <div class="stat"><div class="stat-v">' + s(p.stat_2_value,'500+') + '</div><div class="stat-l">' + s(p.stat_2_label,'Customers') + '</div></div>\n  <div class="stat"><div class="stat-v">' + s(p.stat_3_value,'99%') + '</div><div class="stat-l">' + s(p.stat_3_label,'Satisfaction') + '</div></div>\n</section>\n\n<section class="features">\n  <div class="section-label">Why ' + s(p.brand_name,'Us') + '</div>\n  <div class="section-title">Built for ' + s(adAnalysis.audience,'you') + '</div>\n  <div class="section-sub">' + s(p.tagline,'') + '</div>\n  <div class="features-grid">\n    <div class="fc"><div class="fc-icon">' + s(p.feature_1_icon,'⚡') + '</div><h3>' + s(p.feature_1_title,'') + '</h3><p>' + s(p.feature_1_desc,'') + '</p></div>\n    <div class="fc"><div class="fc-icon">' + s(p.feature_2_icon,'🎯') + '</div><h3>' + s(p.feature_2_title,'') + '</h3><p>' + s(p.feature_2_desc,'') + '</p></div>\n    <div class="fc"><div class="fc-icon">' + s(p.feature_3_icon,'💎') + '</div><h3>' + s(p.feature_3_title,'') + '</h3><p>' + s(p.feature_3_desc,'') + '</p></div>\n  </div>\n</section>\n\n<section class="social-proof">\n  <div class="section-label">Social Proof</div>\n  <div class="section-title" style="margin-bottom:48px">Real people. Real results.</div>\n  <div class="testimonials-grid">\n    <div class="tc">\n      <div class="stars">★★★★★</div>\n      <p class="tc-quote">"' + s(p.testimonial_1,'Amazing!') + '"</p>\n      <div class="reviewer"><div class="avatar">' + s(p.testimonial_1_name,'A')[0] + '</div><div><div class="r-name">' + s(p.testimonial_1_name,'Customer') + '</div><div class="r-role">' + s(p.testimonial_1_role,'Verified') + '</div></div></div>\n    </div>\n    <div class="tc">\n      <div class="stars">★★★★★</div>\n      <p class="tc-quote">"' + s(p.testimonial_2,'Highly recommended!') + '"</p>\n      <div class="reviewer"><div class="avatar">' + s(p.testimonial_2_name,'S')[0] + '</div><div><div class="r-name">' + s(p.testimonial_2_name,'Customer') + '</div><div class="r-role">' + s(p.testimonial_2_role,'Verified') + '</div></div></div>\n    </div>\n  </div>\n</section>\n\n<section class="cta-band">\n  <h2>' + s(p.hero_headline,'Ready?') + '</h2>\n  <p>' + s(p.tagline || p.hero_sub,'') + '</p>\n  <a href="#" class="btn-w">' + s(p.cta,'Get Started') + '</a>\n</section>\n\n<footer>\n  <div class="footer-logo">' + s(p.brand_name,'Brand') + '</div>\n  <div class="footer-copy">© ' + year + ' ' + s(p.brand_name,'Brand') + '. All rights reserved. · ' + s(p.tagline,'') + '</div>\n</footer>\n</body>\n</html>';

    // Use real page enhancement when possible, fall back to branded mockup
    let finalHtml = personalizedHtml;
    let enhanced = false;

    if (fetchSuccess && rawHtml && rawHtml.length > 500) {
      const isSPA = pageSignals.includes('Page signals empty');
      // Also check if there is meaningful text content in the HTML
      const textContent = rawHtml.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      const hasContent = textContent.length > 1000;
      if (!isSPA && hasContent) {
        try {
          finalHtml = enhanceRealPage(rawHtml, p, new URL(landing_page_url).origin);
          enhanced = true;
        } catch(e) {
          console.error('[Enhancement failed, using mockup]', e.message);
        }
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
