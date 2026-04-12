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

  // Step 1: Fetch the real landing page
  let originalHtml = '';
  let fetchSuccess = false;
  let textContent = '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const lpRes = await fetch(landing_page_url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    clearTimeout(timeout);
    originalHtml = await lpRes.text();
    fetchSuccess = true;

    // Fix relative URLs to absolute so images/styles load
    const baseUrl = new URL(landing_page_url).origin;
    originalHtml = originalHtml
      .replace(/href="\//g, `href="${baseUrl}/`)
      .replace(/src="\//g, `src="${baseUrl}/`)
      .replace(/href='\//g, `href='${baseUrl}/`)
      .replace(/src='\//g, `src='${baseUrl}/`)
      .replace(/url\(\//g, `url(${baseUrl}/`);

    // Extract readable text for AI context
    textContent = originalHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

  } catch (e) {
    fetchSuccess = false;
    try {
      const domain = new URL(landing_page_url).hostname.replace('www.', '');
      textContent = `Domain: ${domain}. Page blocked scraping.`;
    } catch {
      textContent = `URL: ${landing_page_url}`;
    }
  }

  try {
    let prompt = '';

    if (fetchSuccess && originalHtml.length > 500) {
      // We have the real HTML — ask AI to modify ONLY text
      const htmlSlice = originalHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .slice(0, 8000);

      prompt = `You are a CRO expert. Personalize this REAL landing page by modifying ONLY its text content to match an ad creative.

Ad creative: ${ad_description}

EXISTING PAGE TEXT CONTENT:
${textContent}

RULES - STRICTLY FOLLOW:
1. Keep ALL HTML structure, CSS, classes, IDs, images, layout 100% identical
2. Only change TEXT inside these tags: h1, h2, h3, h4, p, button, a, span, li, label
3. Do NOT change any attributes, classes, styles, src, href values
4. Make the text match the ad's tone, headline, CTA, and messaging
5. Use CRO best practices: message match, urgency, benefit-focused copy
6. The output page must look IDENTICAL to the original — same design, same layout

Respond ONLY with valid JSON, no markdown:
{
  "ad_analysis": { "headline": "...", "tone": "...", "cta": "...", "audience": "...", "key_message": "..." },
  "original_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },
  "personalized_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },
  "personalized_html": "[THE COMPLETE MODIFIED HTML WITH ONLY TEXT CHANGED]",
  "changes": ["CRO change 1", "CRO change 2", "CRO change 3", "CRO change 4", "CRO change 5"]
}`;
    } else {
      // Page blocked — generate realistic mockup then personalize
      prompt = `You are a CRO expert and UI designer. The landing page at ${landing_page_url} blocked scraping.

Ad creative: ${ad_description}

Since the page blocked scraping, do this:
1. Create a HIGH-FIDELITY mockup of what ${landing_page_url}'s landing page looks like (based on your knowledge of the brand)
2. Then personalize the copy to match the ad creative using CRO principles
3. Keep the brand's colors, fonts, and style — just change the copy

Generate a complete, beautiful, professional HTML page that:
- Looks like the REAL brand's page
- Has navbar, hero, features, testimonials, CTA, footer
- Uses the brand's actual color scheme
- Has personalized copy matching the ad

Respond ONLY with valid JSON, no markdown:
{
  "ad_analysis": { "headline": "...", "tone": "...", "cta": "...", "audience": "...", "key_message": "..." },
  "original_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },
  "personalized_copy": { "hero_headline": "...", "hero_sub": "...", "cta": "...", "feature_1": "...", "feature_2": "...", "feature_3": "..." },
  "personalized_html": "[COMPLETE HTML]",
  "changes": ["CRO change 1", "CRO change 2", "CRO change 3", "CRO change 4", "CRO change 5"]
}`;
    }

    const nvidiaRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: 'meta/llama-3.3-70b-instruct',
        max_tokens: 4096,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }]
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
