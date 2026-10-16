import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { expect, test } from '@playwright/test';
import { VideoValidator } from '../validators/VideoValidator';

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      if (req.url?.startsWith('/missing.mp4')) {
        res.writeHead(404, { 'content-type': 'video/mp4' });
        res.end('missing');
        return;
      }
      if (req.url?.startsWith('/wrong-mime.mp4')) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>Not a video</title>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('reports broken video URL and incorrect MIME type with report-ready fields', async ({ page, request }) => {
  await page.setContent(`
    <section class="video-player">
      <video id="broken-video" controls src="${baseUrl}/missing.mp4" style="width:320px;height:180px"></video>
    </section>
    <section class="video-player">
      <video id="wrong-mime-video" controls src="${baseUrl}/wrong-mime.mp4" style="width:320px;height:180px"></video>
    </section>
  `);

  const result = await new VideoValidator(request).validate(page, 'https://quality.test/videos', 'Desktop', 'video-test');
  const broken = result.issues.find((issue) => issue.description.startsWith('Broken Video URL'));
  const wrongMime = result.issues.find((issue) => issue.description.startsWith('Incorrect Video MIME Type'));

  expect(broken).toMatchObject({
    category: 'Videos',
    selector: '#broken-video',
    severity: expect.stringMatching(/Critical|High/),
    expected: expect.stringContaining('successful media response'),
    actual: expect.stringContaining('HTTP 404'),
    suggestedFix: expect.stringContaining('Restore the missing video file')
  });
  expect(wrongMime).toMatchObject({
    category: 'Videos',
    selector: '#wrong-mime-video',
    severity: 'High',
    expected: expect.stringContaining('video MIME type'),
    actual: expect.stringContaining('text/html'),
    suggestedFix: expect.stringContaining('Content-Type')
  });
  expect(result.findings.map((finding) => finding.failureType)).toEqual(
    expect.arrayContaining(['Broken Video URL', 'Incorrect Video MIME Type'])
  );
  expect(result.checks.some((check) => check.component === 'Video' && check.result === 'FAIL')).toBe(true);
});

test('reports visible player usability failures without generic technical wording', async ({ page, request }) => {
  await page.setContent(`
    <section class="video-player" style="width:340px;height:200px;border:1px solid #ccc">
      <video id="hidden-video" controls src="${baseUrl}/missing.mp4" style="display:none;width:320px;height:180px"></video>
    </section>
    <section class="video-player" style="position:relative;width:340px;height:200px">
      <video id="disabled-control-video" src="data:video/mp4;base64,AAAA" style="width:320px;height:180px;background:#111"></video>
      <button id="disabled-play" class="play-button" disabled style="position:absolute;left:120px;top:70px;width:90px;height:44px">Play</button>
    </section>
  `);

  const result = await new VideoValidator(request).validate(page, 'https://quality.test/videos', 'Desktop', 'video-test');
  const hidden = result.issues.find((issue) => issue.description.startsWith('Video hidden by CSS'));
  const disabled = result.issues.find((issue) => issue.description.startsWith('Play Button Disabled'));

  expect(hidden).toMatchObject({
    category: 'Videos',
    selector: '#hidden-video',
    severity: 'High',
    actual: expect.stringContaining('display is none'),
    suggestedFix: expect.stringContaining('visibility')
  });
  expect(disabled).toMatchObject({
    category: 'Videos',
    selector: '#disabled-control-video',
    severity: 'High',
    description: expect.stringContaining('Users can see the play control'),
    suggestedFix: expect.stringContaining('Enable the play control')
  });
  expect(result.issues.every((issue) => issue.category === 'Videos')).toBe(true);
});
