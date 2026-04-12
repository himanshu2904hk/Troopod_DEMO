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
    tech: [
      'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1600&q=80',
    ],
    fashion: [
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600&q=80',
    ],
    default: [
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&q=80',
    ]
  };

  const adLower = ad_description.toLowerCase();
  let category = 'default';
  if (adLower.match(/food|eat|hungry|restaurant|delivery|biryani|pizza|burger|chef|cuisine|zomato|swiggy/)) category = 'food';
  else if (adLower.match(/fitness|gym|run|sport|athlete|nike|workout/)) category = 'fitness';
  else if (adLower.match(/tech|software|app|digital|saas/)) category = 'tech';
  else if (adLower.match(/fashion|clothes|wear|style/)) category = 'fashion';

  const images = imagePool[category];
  const heroImage = images[Math.floor(Math.random() * images.length)];

  let landingPageContent = '';
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
    landingPageContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
  } catch (e) {
    try {
      const domain = new URL(landing_page_url).hostname.replace('www.', '');
      landingPageContent = `Domain: ${domain}. Infer typical landing page content.`;
    } catch {
      landingPageContent = `URL: ${landing_page_url}.`;
    }
  }

  try {
    const nvidiaRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: 'meta/llama-3.3-70b-instruct',
        max_tokens: 4096,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are an expert CRO specialist, UI designer and copywriter. Personalize an existing landing page to match an ad creative.

Ad description: ${ad_description}
Landing page URL: ${landing_page_url}
Landing page content: ${landingPageContent}
Hero background image URL (USE THIS EXACT URL): ${heroImage}

Generate a STUNNING personalized HTML landing page that:
1. Looks like the REAL existing page but with personalized copy matching the ad
2. Uses this EXACT hero image: ${heroImage}
3. Has a fixed navbar with logo and CTA button
4. Has a full-screen hero (min-height: 100vh) with the image as background, dark overlay, huge headline (font-size: 72px, font-weight: 900), subheadline, and 2 CTA buttons
5. Has a stats strip with 3-4 impressive numbers
6. Has 3 feature cards with emoji icons, hover effects (transform: translateY(-8px))
7. Has a testimonials section with 2 customer quotes and star ratings
8. Has a final CTA banner section
9. Has a footer with brand name and tagline
10. Uses Google Fonts Inter: <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
11. All inline CSS, professional colors matching the ad brand
12. Mobile responsive

Respond ONLY with valid JSON, no markdown fences:
{
  "ad_analysis": { "headline": "...", "tone": "...", "cta": "...", "audience": "...", "key_message": "..." },
  "original_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },
  "personalized_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },
  "personalized_html": "<!DOCTYPE html><html lang='en'>...</html>",
  "changes": ["change 1", "change 2", "change 3", "change 4", "change 5"]
}`
        }]
      })
    });

    const nvidiaData = await nvidiaRes.json();
    if (!nvidiaRes.ok) {
      return res.status(500).json({ error: 'NVIDIA API error: ' + JSON.stringify(nvidiaData) });
    }

    const raw = nvidiaData.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch { return res.status(500).json({ error: 'Parse failed', raw: clean.slice(0, 300) }); }
      } else {
        return res.status(500).json({ error: 'No JSON found', raw: clean.slice(0, 300) });
      }
    }

    parsed.fetch_success = fetchSuccess;
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
