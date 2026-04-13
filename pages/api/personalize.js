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

  // Comprehensive image pool by category
  const imagePool = {
    food: [
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&q=80',
      'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1600&q=80',
      'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1600&q=80',
    ],
    fitness: [
      'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1600&q=80',
      'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1600&q=80',
      'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1600&q=80',
    ],
    tech: [
      'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=1600&q=80',
      'https://images.unsplash.com/photo-1580910051074-3eb694886505?w=1600&q=80',
      'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1600&q=80',
    ],
    fashion: [
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600&q=80',
      'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1600&q=80',
    ],
    travel: [
      'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1600&q=80',
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80',
    ],
    beauty: [
      'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1600&q=80',
      'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1600&q=80',
    ],
    automotive: [
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1600&q=80',
      'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=1600&q=80',
    ],
    finance: [
      'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&q=80',
      'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=1600&q=80',
    ],
    education: [
      'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1600&q=80',
      'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=1600&q=80',
    ],
    default: [
      'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80',
      'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=1600&q=80',
    ]
  };

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
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1200,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are a CRO expert. Personalize landing page copy to match an ad creative.

Ad creative: ${ad_description}
Landing page brand/content: ${textContent}

Generate personalized copy AND detect the ad category.

Category must be ONE of: food, fitness, tech, fashion, travel, beauty, automotive, finance, education, default

Respond ONLY with valid JSON, no markdown:
{
  "category": "tech",
  "ad_analysis": { "headline": "...", "tone": "...", "cta": "...", "audience": "...", "key_message": "..." },
  "original_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },
  "personalized_copy": {
    "brand_name": "...",
    "tagline": "...",
    "hero_headline": "...",
    "hero_sub": "...",
    "cta": "...",
    "stat_1": "...", "stat_2": "...", "stat_3": "...",
    "feature_1_title": "...", "feature_1_desc": "...",
    "feature_2_title": "...", "feature_2_desc": "...",
    "feature_3_title": "...", "feature_3_desc": "...",
    "testimonial_1": "...", "testimonial_2": "..."
  },
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

    // Use AI-detected category for image selection
    const category = copyData.category && imagePool[copyData.category] ? copyData.category : 'default';
    const images = imagePool[category];
    const heroImage = images[Math.floor(Math.random() * images.length)];

    const p = copyData.personalized_copy;

    // Brand color based on AI-detected category
    const brandColors = {
      food: '#E23744', fitness: '#111111', tech: '#0071e3',
      fashion: '#1a1a1a', travel: '#0077b6', beauty: '#c77dff',
      automotive: '#d62828', finance: '#2d6a4f', education: '#3a86ff', default: '#6366f1'
    };
    const brandColor = brandColors[category] || '#6366f1';
    const brandLights = {
      food: '#fff1f2', fitness: '#f9fafb', tech: '#f0f4ff',
      fashion: '#f9f9f9', travel: '#e0f4ff', beauty: '#f9f0ff',
      automotive: '#fff0f0', finance: '#f0fff4', education: '#f0f4ff', default: '#eef2ff'
    };
    const brandLight = brandLights[category] || '#eef2ff';

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
nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: rgba(255,255,255,0.96); backdrop-filter: blur(10px); padding: 16px 48px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f0f0f0; }
nav .logo { font-size: 22px; font-weight: 800; color: ${brandColor}; letter-spacing: -0.5px; }
nav .nav-cta { background: ${brandColor}; color: white; padding: 10px 24px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
.hero { min-height: 100vh; background: linear-gradient(135deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%), url('${heroImage}') center/cover no-repeat; display: flex; align-items: center; justify-content: center; text-align: center; padding: 120px 24px 80px; }
.hero-content { max-width: 820px; }
.hero h1 { font-size: clamp(40px, 7vw, 80px); font-weight: 900; color: white; line-height: 1.05; margin-bottom: 24px; letter-spacing: -1px; text-shadow: 0 2px 20px rgba(0,0,0,0.3); }
.hero p { font-size: clamp(16px, 2.5vw, 22px); color: rgba(255,255,255,0.88); margin-bottom: 44px; line-height: 1.6; }
.hero-btns { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.btn-primary { background: ${brandColor}; color: white; padding: 16px 40px; border-radius: 10px; border: none; font-size: 16px; font-weight: 700; cursor: pointer; text-decoration: none; transition: transform 0.2s, opacity 0.2s; }
.btn-primary:hover { opacity: 0.9; transform: translateY(-2px); }
.btn-secondary { background: transparent; color: white; padding: 16px 40px; border-radius: 10px; border: 2px solid rgba(255,255,255,0.8); font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none; transition: all 0.2s; }
.btn-secondary:hover { background: white; color: #1a1a1a; }
.stats { background: ${brandColor}; padding: 36px 48px; display: flex; justify-content: center; gap: 80px; flex-wrap: wrap; }
.stat { text-align: center; color: white; }
.stat-num { font-size: 34px; font-weight: 900; letter-spacing: -0.5px; }
.stat-label { font-size: 13px; opacity: 0.8; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
.features { padding: 100px 48px; background: white; }
.features-title { text-align: center; font-size: 40px; font-weight: 800; margin-bottom: 16px; letter-spacing: -0.5px; }
.features-sub { text-align: center; font-size: 18px; color: #666; margin-bottom: 64px; }
.features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 28px; max-width: 1100px; margin: 0 auto; }
.feature-card { background: ${brandLight}; border-radius: 20px; padding: 40px 32px; transition: transform 0.3s, box-shadow 0.3s; }
.feature-card:hover { transform: translateY(-8px); box-shadow: 0 24px 48px rgba(0,0,0,0.1); }
.feature-icon { font-size: 48px; margin-bottom: 20px; }
.feature-card h3 { font-size: 20px; font-weight: 700; margin-bottom: 12px; letter-spacing: -0.3px; }
.feature-card p { font-size: 15px; color: #555; line-height: 1.7; }
.testimonials { background: #f8f9fa; padding: 100px 48px; }
.testimonials h2 { text-align: center; font-size: 36px; font-weight: 800; margin-bottom: 64px; letter-spacing: -0.5px; }
.testimonials-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 28px; max-width: 900px; margin: 0 auto; }
.testimonial-card { background: white; border-radius: 20px; padding: 36px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
.stars { color: #f59e0b; font-size: 22px; margin-bottom: 16px; letter-spacing: 2px; }
.testimonial-card p { font-size: 15px; color: #444; line-height: 1.8; margin-bottom: 24px; font-style: italic; }
.reviewer { display: flex; align-items: center; gap: 12px; }
.avatar { width: 46px; height: 46px; border-radius: 50%; background: ${brandColor}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 16px; flex-shrink: 0; }
.reviewer-info .name { font-weight: 700; font-size: 14px; }
.reviewer-info .role { font-size: 12px; color: #888; margin-top: 2px; }
.cta-section { background: ${brandColor}; padding: 100px 48px; text-align: center; }
.cta-section h2 { font-size: 44px; font-weight: 900; color: white; margin-bottom: 16px; letter-spacing: -1px; }
.cta-section p { font-size: 18px; color: rgba(255,255,255,0.85); margin-bottom: 44px; }
.btn-white { background: white; color: ${brandColor}; padding: 18px 52px; border-radius: 10px; border: none; font-size: 18px; font-weight: 700; cursor: pointer; text-decoration: none; transition: transform 0.2s; display: inline-block; }
.btn-white:hover { transform: translateY(-2px); }
footer { background: #111; color: white; padding: 48px; text-align: center; }
footer .footer-logo { font-size: 22px; font-weight: 800; color: ${brandColor}; margin-bottom: 8px; }
footer p { font-size: 14px; color: #666; margin-top: 4px; }
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
  <div class="stat"><div class="stat-num">${p.stat_1 || '10x'}</div><div class="stat-label">Faster</div></div>
  <div class="stat"><div class="stat-num">${p.stat_2 || '500+'}</div><div class="stat-label">Customers</div></div>
  <div class="stat"><div class="stat-num">${p.stat_3 || '99%'}</div><div class="stat-label">Satisfaction</div></div>
</section>
<section class="features">
  <div class="features-title">Why Choose Us</div>
  <div class="features-sub">${p.tagline || ''}</div>
  <div class="features-grid">
    <div class="feature-card"><div class="feature-icon">⚡</div><h3>${p.feature_1_title || 'Fast'}</h3><p>${p.feature_1_desc || ''}</p></div>
    <div class="feature-card"><div class="feature-icon">🎯</div><h3>${p.feature_2_title || 'Precise'}</h3><p>${p.feature_2_desc || ''}</p></div>
    <div class="feature-card"><div class="feature-icon">💎</div><h3>${p.feature_3_title || 'Premium'}</h3><p>${p.feature_3_desc || ''}</p></div>
  </div>
</section>
<section class="testimonials">
  <h2>What Our Customers Say</h2>
  <div class="testimonials-grid">
    <div class="testimonial-card">
      <div class="stars">★★★★★</div>
      <p>"${p.testimonial_1 || 'Amazing experience!'}"</p>
      <div class="reviewer"><div class="avatar">A</div><div class="reviewer-info"><div class="name">Amit K.</div><div class="role">Verified Customer</div></div></div>
    </div>
    <div class="testimonial-card">
      <div class="stars">★★★★★</div>
      <p>"${p.testimonial_2 || 'Highly recommended!'}"</p>
      <div class="reviewer"><div class="avatar">S</div><div class="reviewer-info"><div class="name">Sneha R.</div><div class="role">Verified Customer</div></div></div>
    </div>
  </div>
</section>
<section class="cta-section">
  <h2>${p.hero_headline || 'Ready?'}</h2>
  <p>${p.tagline || p.hero_sub || ''}</p>
  <a href="#" class="btn-white">${p.cta || 'Get Started Now'}</a>
</section>
<footer>
  <div class="footer-logo">${p.brand_name || 'Brand'}</div>
  <p>${p.tagline || ''}</p>
  <p style="margin-top:12px;color:#444">© 2025 ${p.brand_name || 'Brand'}. All rights reserved.</p>
</footer>
</body>
</html>`;

    return res.status(200).json({
      ad_analysis: copyData.ad_analysis,
      original_copy: copyData.original_copy,
      personalized_copy: copyData.personalized_copy,
      personalized_html: personalizedHtml,
      changes: copyData.changes,
      fetch_success: fetchSuccess,
      category
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
