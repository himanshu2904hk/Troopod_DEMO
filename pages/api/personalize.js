export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ad_description, landing_page_url } = req.body;
  if (!ad_description || !landing_page_url) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const imagePool = {
    food: [
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&q=80',
      'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1600&q=80',
      'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1600&q=80',
    ],
    fitness: [
      'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1600&q=80',
      'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1600&q=80',
    ],
    tech: ['https://images.unsplash.com/photo-1518770660439-4636190af475?w=1600&q=80'],
    fashion: ['https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600&q=80'],
    default: ['https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&q=80']
  };

  const adLower = ad_description.toLowerCase();
  let category = 'default';
  if (adLower.match(/food|eat|hungry|restaurant|delivery|biryani|pizza|burger|chef|cuisine|zomato|swiggy/)) category = 'food';
  else if (adLower.match(/fitness|gym|run|sport|athlete|nike|workout/)) category = 'fitness';
  else if (adLower.match(/tech|software|app|digital|saas/)) category = 'tech';
  else if (adLower.match(/fashion|clothes|wear|style/)) category = 'fashion';

  const images = imagePool[category];
  const heroImage = images[Math.floor(Math.random() * images.length)];

  let textContent = '';
  let fetchSuccess = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const lpRes = await fetch(landing_page_url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      }
    });
    clearTimeout(timeout);
    const html = await lpRes.text();
    fetchSuccess = true;
    textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
  } catch (e) {
    try {
      const domain = new URL(landing_page_url).hostname.replace('www.', '');
      textContent = `Brand: ${domain}`;
    } catch { textContent = landing_page_url; }
  }

  try {
    // Step 1: Get personalized copy from Groq (fast, small response)
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are a CRO expert. Personalize landing page copy to match an ad creative.

Ad creative: ${ad_description}
Landing page brand/content: ${textContent}

Generate personalized copy that:
- Matches the ad's headline, tone, CTA and messaging
- Uses CRO best practices (message match, urgency, benefit-focused)
- Keeps the brand identity of the landing page

Respond ONLY with valid JSON, no markdown:
{
  "ad_analysis": { "headline": "...", "tone": "...", "cta": "...", "audience": "...", "key_message": "..." },
  "original_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "...", "stat_1": "...", "stat_2": "...", "stat_3": "...", "testimonial_1": "...", "testimonial_2": "..." },
  "personalized_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1_title": "...", "feature_1_desc": "...", "feature_2_title": "...", "feature_2_desc": "...", "feature_3_title": "...", "feature_3_desc": "...", "stat_1": "...", "stat_2": "...", "stat_3": "...", "testimonial_1": "...", "testimonial_2": "...", "brand_name": "...", "tagline": "..." },
  "changes": ["CRO change 1", "CRO change 2", "CRO change 3", "CRO change 4", "CRO change 5"]
}`
        }]
      })
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) throw new Error('Groq error: ' + JSON.stringify(groqData));

    const raw = groqData.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    let copyData;
    try { copyData = JSON.parse(clean); }
    catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) copyData = JSON.parse(match[0]);
      else throw new Error('Parse failed: ' + clean.slice(0, 200));
    }

    const p = copyData.personalized_copy;
    const brandColor = category === 'food' ? '#E23744' : category === 'fitness' ? '#111' : category === 'tech' ? '#6366f1' : category === 'fashion' ? '#1a1a1a' : '#6366f1';
    const brandLight = category === 'food' ? '#fff1f2' : category === 'fitness' ? '#f9fafb' : category === 'tech' ? '#eef2ff' : '#f9fafb';

    // Step 2: Build beautiful HTML template with the copy injected
    const personalizedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${p.brand_name || 'Personalized Page'}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; color: #1a1a1a; }
nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); padding: 16px 48px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f0f0f0; }
nav .logo { font-size: 20px; font-weight: 700; color: ${brandColor}; }
nav .nav-cta { background: ${brandColor}; color: white; padding: 10px 24px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
.hero { min-height: 100vh; background: linear-gradient(135deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.45) 100%), url('${heroImage}') center/cover no-repeat; display: flex; align-items: center; justify-content: center; text-align: center; padding: 120px 24px 80px; }
.hero-content { max-width: 800px; }
.hero h1 { font-size: clamp(42px, 7vw, 76px); font-weight: 900; color: white; line-height: 1.1; margin-bottom: 24px; text-shadow: 0 2px 20px rgba(0,0,0,0.3); }
.hero p { font-size: clamp(16px, 2.5vw, 22px); color: rgba(255,255,255,0.9); margin-bottom: 40px; line-height: 1.6; }
.hero-btns { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.btn-primary { background: ${brandColor}; color: white; padding: 16px 36px; border-radius: 10px; border: none; font-size: 16px; font-weight: 700; cursor: pointer; text-decoration: none; transition: transform 0.2s, opacity 0.2s; }
.btn-primary:hover { opacity: 0.9; transform: translateY(-2px); }
.btn-secondary { background: transparent; color: white; padding: 16px 36px; border-radius: 10px; border: 2px solid white; font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none; transition: all 0.2s; }
.btn-secondary:hover { background: white; color: #1a1a1a; }
.stats { background: ${brandColor}; padding: 32px 48px; display: flex; justify-content: center; gap: 80px; flex-wrap: wrap; }
.stat { text-align: center; color: white; }
.stat-num { font-size: 32px; font-weight: 900; }
.stat-label { font-size: 14px; opacity: 0.85; margin-top: 4px; }
.features { padding: 100px 48px; background: white; }
.features h2 { text-align: center; font-size: 40px; font-weight: 800; margin-bottom: 60px; }
.features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 32px; max-width: 1100px; margin: 0 auto; }
.feature-card { background: ${brandLight}; border-radius: 16px; padding: 40px 32px; transition: transform 0.3s, box-shadow 0.3s; }
.feature-card:hover { transform: translateY(-8px); box-shadow: 0 20px 40px rgba(0,0,0,0.1); }
.feature-icon { font-size: 48px; margin-bottom: 20px; }
.feature-card h3 { font-size: 20px; font-weight: 700; margin-bottom: 12px; }
.feature-card p { font-size: 15px; color: #555; line-height: 1.7; }
.testimonials { background: #f9fafb; padding: 100px 48px; }
.testimonials h2 { text-align: center; font-size: 36px; font-weight: 800; margin-bottom: 60px; }
.testimonials-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 32px; max-width: 900px; margin: 0 auto; }
.testimonial-card { background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
.stars { color: #f59e0b; font-size: 20px; margin-bottom: 16px; }
.testimonial-card p { font-size: 15px; color: #444; line-height: 1.7; margin-bottom: 20px; font-style: italic; }
.reviewer { display: flex; align-items: center; gap: 12px; }
.avatar { width: 44px; height: 44px; border-radius: 50%; background: ${brandColor}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 16px; }
.reviewer-name { font-weight: 600; font-size: 14px; }
.cta-section { background: ${brandColor}; padding: 100px 48px; text-align: center; }
.cta-section h2 { font-size: 42px; font-weight: 900; color: white; margin-bottom: 16px; }
.cta-section p { font-size: 18px; color: rgba(255,255,255,0.85); margin-bottom: 40px; }
.btn-white { background: white; color: ${brandColor}; padding: 18px 48px; border-radius: 10px; border: none; font-size: 18px; font-weight: 700; cursor: pointer; text-decoration: none; transition: transform 0.2s; display: inline-block; }
.btn-white:hover { transform: translateY(-2px); }
footer { background: #1a1a1a; color: white; padding: 40px 48px; text-align: center; }
footer .footer-logo { font-size: 20px; font-weight: 700; color: ${brandColor}; margin-bottom: 8px; }
footer p { font-size: 14px; color: #888; }
</style>
</head>
<body>
<nav>
  <div class="logo">${p.brand_name || 'Brand'}</div>
  <a href="#" class="nav-cta">${p.cta || 'Get Started'}</a>
</nav>

<section class="hero">
  <div class="hero-content">
    <h1>${p.hero_headline || 'Welcome'}</h1>
    <p>${p.hero_sub || ''}</p>
    <div class="hero-btns">
      <a href="#" class="btn-primary">${p.cta || 'Get Started'}</a>
      <a href="#" class="btn-secondary">Learn More</a>
    </div>
  </div>
</section>

<section class="stats">
  <div class="stat"><div class="stat-num">${p.stat_1 || '10x'}</div><div class="stat-label">Faster Results</div></div>
  <div class="stat"><div class="stat-num">${p.stat_2 || '500+'}</div><div class="stat-label">Happy Customers</div></div>
  <div class="stat"><div class="stat-num">${p.stat_3 || '99%'}</div><div class="stat-label">Satisfaction Rate</div></div>
</section>

<section class="features">
  <h2>Why Choose Us</h2>
  <div class="features-grid">
    <div class="feature-card">
      <div class="feature-icon">⚡</div>
      <h3>${p.feature_1_title || 'Fast & Reliable'}</h3>
      <p>${p.feature_1_desc || ''}</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">🎯</div>
      <h3>${p.feature_2_title || 'Precision'}</h3>
      <p>${p.feature_2_desc || ''}</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">💎</div>
      <h3>${p.feature_3_title || 'Premium Quality'}</h3>
      <p>${p.feature_3_desc || ''}</p>
    </div>
  </div>
</section>

<section class="testimonials">
  <h2>What Our Customers Say</h2>
  <div class="testimonials-grid">
    <div class="testimonial-card">
      <div class="stars">★★★★★</div>
      <p>"${p.testimonial_1 || 'Amazing experience!'}"</p>
      <div class="reviewer"><div class="avatar">A</div><div class="reviewer-name">Amit K.</div></div>
    </div>
    <div class="testimonial-card">
      <div class="stars">★★★★★</div>
      <p>"${p.testimonial_2 || 'Highly recommended!'}"</p>
      <div class="reviewer"><div class="avatar">S</div><div class="reviewer-name">Sneha R.</div></div>
    </div>
  </div>
</section>

<section class="cta-section">
  <h2>${p.hero_headline || 'Ready to Get Started?'}</h2>
  <p>${p.tagline || p.hero_sub || ''}</p>
  <a href="#" class="btn-white">${p.cta || 'Get Started Now'}</a>
</section>

<footer>
  <div class="footer-logo">${p.brand_name || 'Brand'}</div>
  <p>${p.tagline || ''}</p>
  <p style="margin-top:12px">© 2025 ${p.brand_name || 'Brand'}. All rights reserved.</p>
</footer>
</body>
</html>`;

    return res.status(200).json({
      ad_analysis: copyData.ad_analysis,
      original_copy: copyData.original_copy,
      personalized_copy: copyData.personalized_copy,
      personalized_html: personalizedHtml,
      changes: copyData.changes,
      fetch_success: fetchSuccess
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
