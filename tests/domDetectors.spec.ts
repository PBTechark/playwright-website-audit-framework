import { expect, test } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { detectDomDefects, detectReloadShiftDefects, detectShiftDefects } from '../utils/domDetectors';

test.describe.configure({ mode: 'serial' });

test('detects human-visible server-rendered position changes between loads', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  let requestCount = 0;
  await page.route('https://shift.test/menu', async (route) => {
    requestCount += 1;
    const margin = requestCount % 2 === 1 ? 0 : 70;
    await route.fulfill({
      contentType: 'text/html',
      body: `<ul><li style="margin-left:${margin}px"><a href="/menu">Moving menu item</a></li></ul>`
    });
  });
  await page.goto('https://shift.test/menu');

  const defects = await detectReloadShiftDefects(page);

  expect(defects).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'Content Shift' })
  ]));
  expect(defects.find((item) => item.type === 'Content Shift')?.details).toMatchObject({
    assertion: 'human-visible reload position stability',
    decision: 'CRITICAL',
    pixelMovement: 70
  });
});

test('ignores barely noticeable reload movement in human vision mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  let requestCount = 0;
  await page.route('https://shift.test/small-menu', async (route) => {
    requestCount += 1;
    const margin = requestCount % 2 === 1 ? 0 : 25;
    await route.fulfill({
      contentType: 'text/html',
      body: `<ul><li style="margin-left:${margin}px"><a href="/menu">Small moving menu item</a></li></ul>`
    });
  });
  await page.goto('https://shift.test/small-menu');

  const defects = await detectReloadShiftDefects(page);

  expect(defects.filter((item) => item.type.includes('Shift'))).toHaveLength(0);
});

test('strict mode preserves legacy reload sensitivity', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const originalMode = auditConfig.layoutShift.mode;
  auditConfig.layoutShift.mode = 'strict';
  try {
    let requestCount = 0;
    await page.route('https://shift.test/strict-menu', async (route) => {
      requestCount += 1;
      const margin = requestCount % 2 === 1 ? 0 : 3;
      await route.fulfill({
        contentType: 'text/html',
        body: `<ul><li style="margin-left:${margin}px"><a href="/menu">Strict moving menu item</a></li></ul>`
      });
    });
    await page.goto('https://shift.test/strict-menu');

    const defects = await detectReloadShiftDefects(page);

    expect(defects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'Content Shift',
        details: expect.objectContaining({
          assertion: 'reload position stability',
          layoutShiftMode: 'strict'
        })
      })
    ]));
  } finally {
    auditConfig.layoutShift.mode = originalMode;
  }
});

test('reports persistent human-visible in-load movement with importance evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const originalStabilityWindow = auditConfig.layoutShift.stabilityWindowMs;
  const originalPersistence = auditConfig.layoutShift.persistenceMs;
  auditConfig.layoutShift.stabilityWindowMs = 50;
  auditConfig.layoutShift.persistenceMs = 900;
  try {
    await page.setContent(`
      <style>
        #hero { position:absolute; left:20px; top:20px; width:260px; height:60px; }
      </style>
      <section id="hero"><button>Get started</button></section>
      <script>
        setTimeout(() => { document.querySelector('#hero').style.top = '70px'; }, 600);
      </script>
    `);

    const defects = await detectShiftDefects(page);

    expect(defects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'Layout Shift',
        selector: '#hero',
        severity: 'Critical',
        details: expect.objectContaining({
          assertion: 'human-visible post-load layout stability',
          importanceCategory: 'hero',
          pixelMovement: 50,
          decision: 'CRITICAL'
        })
      })
    ]));
  } finally {
    auditConfig.layoutShift.stabilityWindowMs = originalStabilityWindow;
    auditConfig.layoutShift.persistenceMs = originalPersistence;
  }
});

test('detects a corner image obstructing a control in iPad portrait only', async ({ page }) => {
  await page.setContent(`
    <style>
      select { position:absolute; top:90px; left:50%; transform:translateX(-50%); width:calc(100% - 54px); max-width:970px; height:21px; }
      img { position:fixed; right:0; top:0; width:100px; height:100px; }
    </style>
    <select id="dropdown" aria-label="Example"><option>Example</option></select>
    <a href="https://example.com"><img alt="Corner ribbon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='green'/%3E%3C/svg%3E"></a>
  `);

  await page.setViewportSize({ width: 1024, height: 1366 });
  const portrait = await detectDomDefects(page);
  expect(portrait).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'Element Overlap',
      selector: expect.stringContaining('#dropdown'),
      details: expect.objectContaining({
        occludedSelector: '#dropdown',
        criticalEdgeBlocked: true,
        persistenceSamples: 3
      })
    })
  ]));

  await page.setViewportSize({ width: 1366, height: 1024 });
  const landscape = await detectDomDefects(page);
  expect(landscape.filter((item) => item.type === 'Element Overlap')).toHaveLength(0);
});

test('does not report content that scrolls underneath a higher sticky header', async ({ page }) => {
  await page.setContent(`
    <style>
      body { margin:0; min-height:1800px; }
      header { position:fixed; z-index:10; inset:0 0 auto; height:80px; background:white; }
      #logo { position:absolute; left:40px; top:10px; width:280px; height:60px; }
      #portrait { position:absolute; left:40px; top:0; width:420px; height:480px; }
    </style>
    <header><a id="logo" href="/"><span>Company logo</span></a></header>
    <main><img id="portrait" alt="Team member" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='480'%3E%3Crect width='420' height='480' fill='navy'/%3E%3C/svg%3E"></main>
  `);

  const defects = await detectDomDefects(page);

  expect(defects.filter((item) => item.type === 'Element Overlap')).toHaveLength(0);
});

test('does not report hidden offscreen contact drawers as visible defects', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <style>
      body { margin:0; min-height:1200px; overflow-x:hidden; }
      aside { position:fixed; left:-430px; top:120px; width:400px; background:white; }
      .tab { position:fixed; left:0; top:220px; width:58px; height:190px; background:#b91c1c; color:white; }
      input, textarea { display:block; width:370px; height:40px; margin:12px; }
      .message { width:400px; height:125px; }
    </style>
    <button class="tab">Contact Us</button>
    <aside aria-label="Contact drawer">
      <form>
        <input id="fullname" placeholder="Name">
        <input id="email" placeholder="Email">
        <input id="phone" placeholder="Phone">
        <div class="message"></div>
      </form>
    </aside>
    <main><h1>Visible page content</h1><p>The drawer is closed and should not be audited as visible page damage.</p></main>
  `);

  const defects = await detectDomDefects(page);

  expect(defects.filter((item) => item.type === 'Off-screen Content')).toHaveLength(0);
  expect(defects.filter((item) => item.type === 'Empty Container')).toHaveLength(0);
});

test('does not report animated reveal placeholders as empty containers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <style>
      #workflow-visual { width:100%; height:360px; transition:opacity 800ms ease, transform 800ms ease; }
      .reveal-motion { transform:translateY(28px); will-change:transform, opacity; background:linear-gradient(#eef, #fff); }
    </style>
    <main>
      <section id="workflow-visual" class="workflow reveal-motion" data-aos="fade-up"></section>
      <section><h2>Next content</h2><p>The following section is visible.</p></section>
    </main>
  `);

  const defects = await detectDomDefects(page);

  expect(defects.filter((item) => item.type === 'Empty Container')).toHaveLength(0);
});

test('reports a named empty content card that would look broken to a manual tester', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <main>
      <section id="feature-card" class="feature-card" style="width:420px;height:220px;border:1px solid #bbb;box-shadow:0 2px 6px #ddd;"></section>
    </main>
  `);

  const defects = await detectDomDefects(page);

  expect(defects).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'Empty Container',
      selector: '#feature-card',
      severity: 'Medium',
      details: expect.objectContaining({
        width: 422,
        height: 222
      })
    })
  ]));
});

test('reports large blank whitespace after the footer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <style>
      body { margin:0; min-height:1000px; }
      main { height:260px; }
      footer { height:180px; background:#790814; color:white; }
    </style>
    <main><h1>Transparency in Coverage Rule</h1></main>
    <footer>Footer links</footer>
  `);

  const defects = await detectDomDefects(page);

  expect(defects).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'Excessive Page-End Whitespace',
      selector: 'body > footer:nth-of-type(1)',
      severity: 'High',
      details: expect.objectContaining({
        trailingWhitespace: 560
      })
    })
  ]));
});

test('does not report a normal sticky header as footer obstruction', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.setContent(`
    <style>
      body { margin:0; }
      header { position:sticky; top:0; height:72px; background:#fff; z-index:10; }
      main { min-height:1200px; }
      footer { height:220px; background:#222; color:#fff; }
    </style>
    <header><a href="/">Logo</a></header>
    <main><h1>About</h1><p>Content</p></main>
    <footer>Footer content</footer>
  `);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  const defects = await detectDomDefects(page);

  expect(defects.filter((item) => item.type === 'Footer Obstruction')).toHaveLength(0);
});

test('reports only partially visible content that is actually cut off', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <style>
      body { margin:0; overflow-x:hidden; }
      #cta { position:absolute; left:-90px; top:80px; width:180px; height:48px; }
    </style>
    <button id="cta">Partially hidden CTA</button>
  `);

  const defects = await detectDomDefects(page);

  expect(defects).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'Off-screen Content', selector: '#cta' })
  ]));
});

test('does not report DOM overflow when users cannot horizontally scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <style>
      body { margin:0; overflow-x:hidden; }
      #decor { position:absolute; left:1400px; top:40px; width:300px; height:120px; background:#eee; }
    </style>
    <main><h1>Rendered content is fine</h1><p>No visible customer-facing overflow exists.</p></main>
    <div id="decor" aria-hidden="true"></div>
  `);

  const defects = await detectDomDefects(page);

  expect(defects.filter((item) => item.type === 'Horizontal Scroll')).toHaveLength(0);
  expect(defects.filter((item) => item.type === 'Off-screen Content')).toHaveLength(0);
});

test('reports horizontal scroll only when visible content creates a user-scrollable defect', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <style>
      body { margin:0; }
      #wide-content { width:1500px; padding:24px; background:#f5f5f5; }
    </style>
    <main id="wide-content"><h1>Wide user-facing content</h1><p>This content visibly forces horizontal scrolling.</p></main>
  `);

  const defects = await detectDomDefects(page);

  expect(defects).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'Horizontal Scroll', selector: '#wide-content' })
  ]));
});

test('ignores floating back-to-top utilities near the viewport edge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <style>
      body { margin:0; min-height:2400px; }
      #main-content { width:100%; min-height:1800px; }
      #back-shell { position:fixed; right:-186px; bottom:20px; width:256px; height:60px; }
      #back-to-top { width:42px; height:42px; }
    </style>
    <main id="main-content"><h1>About Us</h1><p>Rendered page content is visually intact.</p></main>
    <div id="back-shell"><button id="back-to-top" aria-label="Back to top">^</button></div>
  `);

  const defects = await detectDomDefects(page);

  expect(defects.filter((item) => item.type === 'Off-screen Content')).toHaveLength(0);
  expect(defects.filter((item) => item.type === 'Icon/Text Alignment')).toHaveLength(0);
});

test('detects visible icon and text alignment issues', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <div id="contact-row" style="display:flex; align-items:flex-start; gap:14px; margin:40px;">
      <img id="contact-icon" alt="" style="width:32px; height:32px; margin-top:28px;"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='16' fill='red'/%3E%3C/svg%3E">
      <p id="contact-text" style="margin:0; font-size:16px; line-height:20px;">Call<br>(757) 350-4580</p>
    </div>
  `);

  const defects = await detectDomDefects(page);

  expect(defects).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'Icon/Text Alignment',
      selector: '#contact-row'
    })
  ]));
});

test('does not report aligned icon and text rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(`
    <div id="contact-row" style="display:flex; align-items:center; gap:14px; margin:40px;">
      <img id="contact-icon" alt="" style="width:32px; height:32px;"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='16' fill='green'/%3E%3C/svg%3E">
      <p id="contact-text" style="margin:0; font-size:16px; line-height:20px;">Call<br>(757) 350-4580</p>
    </div>
  `);

  const defects = await detectDomDefects(page);

  expect(defects.filter((item) => item.type === 'Icon/Text Alignment')).toHaveLength(0);
});

test('detects repeated grid alignment, row height, and spacing inconsistencies', async ({ page }) => {
  await page.setContent(`
    <style>
      #cards { display:grid; position:relative; width:400px; height:300px; }
      .card { position:absolute; width:100px; height:100px; background:#eee; }
      .card:nth-child(1) { left:0; top:0; }
      .card:nth-child(2) { left:120px; top:0; }
      .card:nth-child(3) { left:240px; top:0; height:140px; }
      .card:nth-child(4) { left:0; top:170px; }
      .card:nth-child(5) { left:130px; top:170px; }
      .card:nth-child(6) { left:275px; top:170px; }
    </style>
    <section id="cards" class="cards-grid">
      <article class="card">One</article><article class="card">Two</article><article class="card">Three</article>
      <article class="card">Four</article><article class="card">Five</article><article class="card">Six</article>
    </section>
  `);

  const defects = await detectDomDefects(page);

  expect(defects).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'Grid/Card Alignment', selector: '#cards' }),
    expect.objectContaining({ type: 'Repeated Row Height Mismatch', selector: '#cards' }),
    expect.objectContaining({ type: 'Spacing Inconsistency', selector: '#cards' })
  ]));
});

test('detects a misaligned horizontal form label and input pair', async ({ page }) => {
  await page.setContent(`
    <style>
      form { display:flex; align-items:flex-start; gap:16px; }
      label { width:100px; height:20px; }
      input { width:220px; height:30px; margin-top:30px; }
    </style>
    <form id="profile"><label for="name">Name</label><input id="name" value="Ada"></form>
  `);

  const defects = await detectDomDefects(page);

  expect(defects).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'Form Label/Input Alignment',
      selector: '#name',
      details: expect.objectContaining({ orientation: 'horizontal' })
    })
  ]));
});
