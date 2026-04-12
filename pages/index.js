import { useState } from 'react';
import Head from 'next/head';
import styles from '../styles/Home.module.css';

export default function Home() {
  const [adDesc, setAdDesc] = useState('');
  const [lpUrl, setLpUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const steps = ['Fetching landing page...', 'Analyzing ad creative...', 'Applying CRO personalization...', 'Almost done...'];

  async function generate() {
    setError('');
    setResult(null);
    if (!adDesc.trim()) { setError('Please describe your ad creative.'); return; }
    if (!lpUrl.trim()) { setError('Please enter a landing page URL.'); return; }
    setLoading(true);
    let i = 0;
    setStatus(steps[0]);
    const timer = setInterval(() => { i = Math.min(i + 1, steps.length - 1); setStatus(steps[i]); }, 2500);
    try {
      const res = await fetch('/api/personalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_description: adDesc, landing_page_url: lpUrl })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setStatus('Done!');
    } catch (err) {
      setError('Error: ' + err.message);
      setStatus('');
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <Head><title>Troopod — Ad Landing Page Personalizer</title></Head>
      <div className={styles.header}>
        <h1>Ad landing page personalizer</h1>
        <p>Describe your ad + paste a landing page URL → get a CRO-optimized personalized page instantly</p>
      </div>
      <div className={styles.card}>
        <label>Describe your ad creative</label>
        <p className={styles.sub}>What does the ad say? Tone, product, headline, CTA, visuals?</p>
        <textarea rows={4} value={adDesc} onChange={e => setAdDesc(e.target.value)}
          placeholder="e.g. Zomato ad with bold red visuals, steaming biryani. Headline: Hungry? We've Got You. Playful urgent tone. CTA: Order Now - First delivery FREE." />
      </div>
      <div className={styles.card}>
        <label>Landing page URL</label>
        <p className={styles.sub}>The existing page you want to personalize</p>
        <input type="text" value={lpUrl} onChange={e => setLpUrl(e.target.value)} placeholder="https://swiggy.com" />
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <button className={styles.btn} onClick={generate} disabled={loading}>
        {loading ? 'Personalizing...' : 'Generate personalized page'}
      </button>
      {status && <p className={styles.status}>{status}</p>}
      {result && (
        <div className={styles.output}>
          {result.ad_analysis && (
            <div className={styles.section}>
              <h2>Ad analysis</h2>
              <div className={styles.tags}>
                {Object.entries(result.ad_analysis).map(([k, v]) => (
                  <span key={k} className={styles.tag}>{k.replace(/_/g, ' ')}: {v}</span>
                ))}
              </div>
            </div>
          )}
          {result.original_copy && result.personalized_copy && (
            <div className={styles.section}>
              <h2>Copy changes</h2>
              <div className={styles.copyGrid}>
                <div className={styles.copyCol}>
                  <div className={styles.copyHeader}>Original</div>
                  <div className={styles.copyBody}>
                    <p className={styles.copyHeadline}>{result.original_copy.hero_headline}</p>
                    <p className={styles.copySub}>{result.original_copy.hero_sub}</p>
                    <span className={styles.copyCta}>{result.original_copy.cta}</span>
                    <div className={styles.copyFeatures}>
                      {[result.original_copy.feature_1, result.original_copy.feature_2, result.original_copy.feature_3].filter(Boolean).map((f, i) => <p key={i}>• {f}</p>)}
                    </div>
                  </div>
                </div>
                <div className={styles.copyCol}>
                  <div className={`${styles.copyHeader} ${styles.persCopyHeader}`}>Personalized</div>
                  <div className={styles.copyBody}>
                    <p className={`${styles.copyHeadline} ${styles.persHeadline}`}>{result.personalized_copy.hero_headline}</p>
                    <p className={styles.copySub}>{result.personalized_copy.hero_sub}</p>
                    <span className={`${styles.copyCta} ${styles.persCta}`}>{result.personalized_copy.cta}</span>
                    <div className={styles.copyFeatures}>
                      {[result.personalized_copy.feature_1, result.personalized_copy.feature_2, result.personalized_copy.feature_3].filter(Boolean).map((f, i) => <p key={i}>• {f}</p>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className={styles.section}>
            <h2>Personalized landing page</h2>
            {!result.fetch_success && (
              <p className={styles.assumption}>Note: Page blocked scraping — generated high-fidelity mockup based on brand, then personalized it.</p>
            )}
            <div className={styles.iframeCol}>
              <div className={`${styles.iframeLabel} ${styles.persLabel}`} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Personalized version</span>
                <button onClick={() => {
                  const blob = new Blob([result.personalized_html], {type: 'text/html'});
                  const url = URL.createObjectURL(blob);
                  window.open(url, '_blank');
                }} style={{fontSize:'11px',padding:'3px 10px',background:'#3C3489',color:'#fff',border:'none',borderRadius:'4px',cursor:'pointer'}}>
                  Open full screen ↗
                </button>
              </div>
              <iframe srcDoc={result.personalized_html} className={styles.iframe} title="Personalized" sandbox="allow-scripts" style={{height:'700px'}} />
            </div>
          </div>
          {result.changes?.length > 0 && (
            <div className={styles.changes}>
              <p className={styles.changesTitle}>CRO changes applied</p>
              {result.changes.map((c, i) => <p key={i} className={styles.change}>• {c}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
