import { useState } from 'react';
import Head from 'next/head';
import styles from '../styles/Home.module.css';

export default function Home() {
  const [adDesc, setAdDesc] = useState('');
  const [adImageUrl, setAdImageUrl] = useState('');
  const [lpUrl, setLpUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [activeTab, setActiveTab] = useState('describe');

  const steps = ['Fetching landing page...', 'Analyzing ad creative...', 'Applying CRO personalization...', 'Building personalized page...'];

  async function generate() {
    setError('');
    setResult(null);
    if (!adDesc.trim() && !adImageUrl.trim()) { setError('Please describe your ad or paste an image URL.'); return; }
    if (!lpUrl.trim()) { setError('Please enter a landing page URL.'); return; }
    try { new URL(lpUrl); } catch { setError('Please enter a valid URL (e.g. https://swiggy.com)'); return; }

    setLoading(true);
    let i = 0;
    setStatus(steps[0]);
    const timer = setInterval(() => { i = Math.min(i + 1, steps.length - 1); setStatus(steps[i]); }, 2500);

    try {
      const res = await fetch('/api/personalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ad_description: adDesc,
          ad_image_url: adImageUrl,
          landing_page_url: lpUrl
        })
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
        <div className={styles.logo}>Troopod</div>
        <h1>Ad landing page personalizer</h1>
        <p>Input your ad creative + landing page URL → get a CRO-optimized personalized page instantly</p>
      </div>

      <div className={styles.card}>
        <label>Ad creative</label>
        <p className={styles.sub}>Describe your ad OR paste an image URL</p>
        <div className={styles.tabRow}>
          <button className={`${styles.tab} ${activeTab === 'describe' ? styles.tabActive : ''}`} onClick={() => setActiveTab('describe')}>Describe ad</button>
          <button className={`${styles.tab} ${activeTab === 'image' ? styles.tabActive : ''}`} onClick={() => setActiveTab('image')}>Image URL</button>
          <button className={`${styles.tab} ${activeTab === 'both' ? styles.tabActive : ''}`} onClick={() => setActiveTab('both')}>Both</button>
        </div>

        {(activeTab === 'describe' || activeTab === 'both') && (
          <textarea rows={4} value={adDesc} onChange={e => setAdDesc(e.target.value)}
            placeholder="e.g. Apple iPhone 16 Pro ad - cinematic black background, close-up of camera lens. Headline: Think Different. Shoot Different. Bold minimalist tone targeting creative professionals. CTA: Order Now."
            style={{marginBottom: activeTab === 'both' ? '12px' : '0'}}
          />
        )}

        {(activeTab === 'image' || activeTab === 'both') && (
          <div>
            <input type="text" value={adImageUrl} onChange={e => { setAdImageUrl(e.target.value); setImageError(false); }}
              placeholder="https://example.com/ad-image.jpg" />
            {adImageUrl && !imageError && (
              <div className={styles.imagePreview}>
                <img src={adImageUrl} alt="Ad preview" onError={() => setImageError(true)} />
              </div>
            )}
            {imageError && <p className={styles.imageError}>Could not load image — check the URL</p>}
          </div>
        )}
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
      {status && <p className={styles.status}>{loading ? '⟳ ' : '✓ '}{status}</p>}

      {result && (
        <div className={styles.output}>
          {result.ad_analysis && (
            <div className={styles.section}>
              <h2>Ad analysis</h2>
              <div className={styles.tags}>
                {Object.entries(result.ad_analysis).map(([k, v]) => (
                  <span key={k} className={styles.tag}>{k.replace(/_/g, ' ')}: {v}</span>
                ))}
                {result.category && <span className={styles.tagCategory}>category: {result.category}</span>}
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
                      {[result.personalized_copy.feature_1_title, result.personalized_copy.feature_2_title, result.personalized_copy.feature_3_title].filter(Boolean).map((f, i) => <p key={i}>• {f}</p>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className={styles.section}>
            <h2>Personalized landing page</h2>
            {!result.fetch_success && (
              <p className={styles.assumption}>Note: Original page blocked scraping — generated high-fidelity brand mockup, then personalized it.</p>
            )}
            <div className={styles.iframeCol}>
              <div className={`${styles.iframeLabel} ${styles.persLabel}`} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Personalized version of {lpUrl}</span>
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
