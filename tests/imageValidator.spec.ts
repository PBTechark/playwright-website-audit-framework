import { expect, test, type APIRequestContext } from '@playwright/test';
import { ImageValidator } from '../validators/ImageValidator';

test('reports upscaled and canvas-detected blurry images with actionable evidence', async ({ page, request }) => {
  await page.setContent(`
    <img id="upscaled" alt="Sharp checker pattern" style="width:96px;height:96px">
    <img id="blurry" alt="Soft gradient" style="width:128px;height:128px">
  `);
  await page.evaluate(() => {
    const checker = document.createElement('canvas');
    checker.width = 16;
    checker.height = 16;
    const checkerContext = checker.getContext('2d')!;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        checkerContext.fillStyle = (x + y) % 2 ? '#fff' : '#000';
        checkerContext.fillRect(x * 4, y * 4, 4, 4);
      }
    }

    const gradient = document.createElement('canvas');
    gradient.width = 128;
    gradient.height = 128;
    const gradientContext = gradient.getContext('2d')!;
    const fill = gradientContext.createLinearGradient(0, 0, 128, 0);
    fill.addColorStop(0, '#000');
    fill.addColorStop(1, '#fff');
    gradientContext.fillStyle = fill;
    gradientContext.fillRect(0, 0, 128, 128);

    (document.querySelector('#upscaled') as HTMLImageElement).src = checker.toDataURL('image/png');
    (document.querySelector('#blurry') as HTMLImageElement).src = gradient.toDataURL('image/png');
  });
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));

  const result = await new ImageValidator(request).validate(page, 'https://quality.test/images', 'Desktop', 'quality-test');
  const upscaled = result.issues.find((issue) => issue.description.startsWith('Upscaled Image'));
  const blurry = result.issues.find((issue) => issue.description.startsWith('Blurry Image'));

  expect(upscaled).toMatchObject({
    selector: '#upscaled',
    severity: 'Medium',
    expected: expect.any(String),
    actual: expect.stringContaining('maximum upscale'),
    suggestedFix: expect.any(String)
  });
  expect(blurry).toMatchObject({
    selector: '#blurry',
    severity: 'Medium',
    expected: expect.stringContaining('sharpness score'),
    actual: expect.stringContaining('Sharpness score'),
    suggestedFix: expect.any(String)
  });
  expect(upscaled?.evidence?.length).toBeGreaterThan(0);
  expect(blurry?.evidence?.length).toBeGreaterThan(0);
});

test('does not report broken rendering for hidden or fallback-backed images', async ({ page, request }) => {
  await page.setContent(`
    <img id="hidden-preload" alt="" style="display:none" src="https://assets.test/missing-hidden.jpg">
    <figure id="fallback-card" style="width:240px;height:120px;border:1px solid #ccc">
      <img id="fallback-image" alt="" style="width:80px;height:80px" src="data:image/png;base64,not-a-real-image">
      <figcaption>Board member portrait coming soon</figcaption>
    </figure>
  `);

  const result = await new ImageValidator(request).validate(page, 'https://quality.test/images', 'Desktop', 'quality-test');

  expect(result.issues.filter((issue) => issue.description.startsWith('Broken Image Rendering'))).toHaveLength(0);
  expect(result.issues.filter((issue) => issue.description.startsWith('Image Request Failed'))).toHaveLength(0);
});

test('does not report request failure when browser rendered the visible image', async ({ page }) => {
  await page.route('https://assets.test/rendered-ok.png', async (route) => {
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      )
    });
  });
  await page.setContent(`
    <img id="rendered-ok" alt="Rendered OK" style="width:80px;height:80px" src="https://assets.test/rendered-ok.png">
  `);
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('#rendered-ok');
    return image?.complete && image.naturalWidth > 0;
  });

  const blockedRequest = {
    get: async () => {
      throw new Error('Synthetic API request failure');
    }
  } as unknown as APIRequestContext;
  const result = await new ImageValidator(blockedRequest).validate(page, 'https://quality.test/images', 'Desktop', 'quality-test');

  expect(result.issues.filter((issue) => issue.description.startsWith('Image Request Failed'))).toHaveLength(0);
  expect(result.issues.filter((issue) => issue.description.startsWith('Broken Image Rendering'))).toHaveLength(0);
});

test('reports broken rendering when a visible customer-facing image has no fallback', async ({ page, request }) => {
  await page.setContent(`
    <img id="broken-visible" alt="Team portrait" style="width:120px;height:90px" src="data:image/png;base64,not-a-real-image">
  `);

  const result = await new ImageValidator(request).validate(page, 'https://quality.test/images', 'Desktop', 'quality-test');

  expect(result.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      selector: '#broken-visible',
      description: expect.stringContaining('Broken Image Rendering'),
      actual: expect.stringContaining('visibleToUser=true')
    })
  ]));
});
