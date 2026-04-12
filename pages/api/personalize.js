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

  // Step 1: Fetch the actual landing page
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

    // Extract readable text
    textContent = originalHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);

  } catch (e) {
    fetchSuccess = false;
    try {
      const domain = new URL(landing_page_url).hostname.replace('www.', '');
      textContent = `Could not fetch page. Domain: ${domain}. Generate a realistic mockup of this brand's landing page.`;
    } catch {
      textContent = `Could not fetch. URL: ${landing_page_url}`;
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
        temperature: 0.4,
        messages: [{
          role: 'user',
          content: `You are a CRO (Conversion Rate Optimization) expert. Your job is to personalize an existing landing page by modifying ONLY its copy to match an ad creative.

Ad creative description: ${ad_description}

Landing page URL: ${landing_page_url}
Page successfully fetched: ${fetchSuccess}
Existing page text content: ${textContent}

${fetchSuccess ? `
TASK: The page was fetched successfully. 
1. Analyze the ad creative — extract: headline, tone, CTA, audience, key message, brand colors
2. Identify the key copy elements on the existing page
3. Rewrite ONLY the text content to match the ad messaging using CRO best practices:
   - Message match: hero headline should mirror the ad headline
   - Same value proposition but in the ad's tone
   - Keep CTAs action-oriented matching the ad's CTA
   - Preserve trust signals but reframe them in the ad's voice
4. Return the COMPLETE modified HTML — same layout, same CSS, same images — ONLY text changed

Return the full modified HTML page.` : `
TASK: The page could not be fetched (blocked scraping).
1. Analyze the ad creative
2. Create a HIGH-FIDELITY mockup of what this brand's landing page likely looks like
3. Then personalize it to match the ad creative
4. Make it look professional and realistic

Generate a complete beautiful HTML page with:
- Fixed navbar with brand logo and CTA
- Full-screen hero with relevant background, huge headline, subheadline, 2 CTA buttons  
- Stats strip with impressive numbers
- 3 feature cards with emoji icons and hover effects
- Testimonials section
- Final CTA banner
- Footer
- Google Fonts Inter
- All inline CSS, brand colors matching the ad`}

Respond ONLY with valid JSON, no markdown:
{
  "ad_analysis": {
    "headline": "...",
    "tone": "...", 
    "cta": "...",
    "audience": "...",
    "key_message": "..."
  },
  "original_copy": {
    "hero_headline": "...",
    "hero_sub": "...",
    "cta": "...",
    "feature_1": "...",
    "feature_2": "...",
    "feature_3": "..."
  },
  "personalized_copy": {
    "hero_headline": "...",
    "hero_sub": "...",
    "cta": "...",
    "feature_1": "...",
    "feature_2": "...",
    "feature_3": "..."
  },
  "personalized_html": "<!DOCTYPE html>...",
  "changes": ["CRO change 1", "CRO change 2", "CRO change 3", "CRO change 4", "CRO change 5"],
  "fetch_success": ${fetchSuccess}
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
