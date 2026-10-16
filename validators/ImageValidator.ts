import { APIRequestContext, Page } from '@playwright/test';
import { createIssue } from '../utils/issueFactory';
import { AuditIssue, ImageFinding, Severity } from '../utils/types';
import { auditConfig } from '../config/auditConfig';
import { mapWithConcurrency } from '../utils/concurrency';
import { EvidenceManager } from '../utils/evidence';

export class ImageValidator {
  constructor(private readonly request: APIRequestContext) {}

  async validate(page: Page, url: string, viewport: string, targetName = 'default'): Promise<{ issues: AuditIssue[]; findings: ImageFinding[] }> {
    const evidence = new EvidenceManager(page, url, viewport, targetName);
    await this.waitForVisibleImageDecode(page);
    const blurThreshold = auditConfig.imageBlurSharpnessThreshold;
    const upscaleTolerance = auditConfig.imageUpscaleTolerance;
    const imageData = await page.evaluate(({ blurThreshold, upscaleTolerance }) => {
      const selectorFor = (element: HTMLImageElement): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const testIdAttribute = element.hasAttribute('data-testid') ? 'data-testid' : 'data-test';
        const testId = element.getAttribute(testIdAttribute);
        if (testId) return `[${testIdAttribute}="${CSS.escape(testId)}"]`;
        const parts: string[] = [];
        let node: Element | null = element;
        while (node && node !== document.body && parts.length < 6) {
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName)
            : [];
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`);
          node = node.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };

      const sharpnessFor = (image: HTMLImageElement) => {
        const source = image.currentSrc || image.src || '';
        const isVectorOrAnimated = /(?:\.svg|\.gif)(?:$|[?#])/i.test(source) || /^data:image\/(?:svg\+xml|gif)/i.test(source);
        if (!image.complete || image.naturalWidth < 3 || image.naturalHeight < 3 || isVectorOrAnimated) {
          return { score: null, contrast: null, sampledWidth: 0, sampledHeight: 0, reason: 'Image is unavailable, vector, or animated.', source: 'rendered-dom' };
        }

        const longestSide = 192;
        const scale = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
        const sampledWidth = Math.max(3, Math.round(image.naturalWidth * scale));
        const sampledHeight = Math.max(3, Math.round(image.naturalHeight * scale));
        try {
          const canvas = document.createElement('canvas');
          canvas.width = sampledWidth;
          canvas.height = sampledHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) {
            return { score: null, contrast: null, sampledWidth, sampledHeight, reason: 'Canvas 2D context is unavailable.', source: 'rendered-dom' };
          }
          context.drawImage(image, 0, 0, sampledWidth, sampledHeight);
          const pixels = context.getImageData(0, 0, sampledWidth, sampledHeight).data;
          const luminance = new Float32Array(sampledWidth * sampledHeight);
          let luminanceTotal = 0;
          let luminanceSquaredTotal = 0;
          for (let pixel = 0, position = 0; pixel < pixels.length; pixel += 4, position += 1) {
            const value = 0.2126 * pixels[pixel] + 0.7152 * pixels[pixel + 1] + 0.0722 * pixels[pixel + 2];
            luminance[position] = value;
            luminanceTotal += value;
            luminanceSquaredTotal += value * value;
          }

          let laplacianTotal = 0;
          let laplacianSquaredTotal = 0;
          let samples = 0;
          for (let y = 1; y < sampledHeight - 1; y += 1) {
            for (let x = 1; x < sampledWidth - 1; x += 1) {
              const position = y * sampledWidth + x;
              const laplacian =
                4 * luminance[position] -
                luminance[position - 1] -
                luminance[position + 1] -
                luminance[position - sampledWidth] -
                luminance[position + sampledWidth];
              laplacianTotal += laplacian;
              laplacianSquaredTotal += laplacian * laplacian;
              samples += 1;
            }
          }
          const pixelCount = luminance.length;
          const luminanceMean = luminanceTotal / pixelCount;
          const contrast = Math.sqrt(Math.max(0, luminanceSquaredTotal / pixelCount - luminanceMean * luminanceMean));
          const laplacianMean = laplacianTotal / Math.max(1, samples);
          const score = Math.max(0, laplacianSquaredTotal / Math.max(1, samples) - laplacianMean * laplacianMean);
          return {
            score: Number(score.toFixed(2)),
            contrast: Number(contrast.toFixed(2)),
            sampledWidth,
            sampledHeight,
            reason: null,
            source: 'rendered-dom'
          };
        } catch (error) {
          return {
            score: null,
            contrast: null,
            sampledWidth,
            sampledHeight,
            reason: error instanceof Error ? error.message : 'Canvas pixels could not be read.',
            source: 'rendered-dom'
          };
        }
      };

      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const visibleArea = (rect: DOMRect): number => {
        const width = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        return width * height;
      };
      const hasFallbackContent = (image: HTMLImageElement): boolean => {
        const parent = image.parentElement;
        if (!parent) return false;
        const text = (parent.innerText || '').trim();
        return text.length > 0 || Boolean(parent.querySelector('picture,svg,canvas,video,[role="img"],[aria-label]'));
      };

      return Array.from(document.images).map((image, index) => {
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        const source = image.currentSrc || image.src || image.getAttribute('src') || '';
        const isVector = /\.svg(?:$|[?#])/i.test(source) || /^data:image\/svg\+xml/i.test(source);
        const scaleX = image.naturalWidth > 0 ? rect.width / image.naturalWidth : 0;
        const scaleY = image.naturalHeight > 0 ? rect.height / image.naturalHeight : 0;
        const upscaleRatio = Math.max(scaleX, scaleY);
        const sharpness = sharpnessFor(image);
        const area = visibleArea(rect);
        const visibleRatio = area / Math.max(1, rect.width * rect.height);
        const visibleToUser =
          rect.width >= 8 &&
          rect.height >= 8 &&
          area >= 64 &&
          visibleRatio >= 0.2 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01 &&
          !Boolean(image.closest('[aria-hidden="true"],[hidden],template,script,style,[data-audit-ignore-visual]'));
        const blurEligible =
          !isVector &&
          visibleToUser &&
          rect.width >= 64 &&
          rect.height >= 64 &&
          sharpness.score !== null &&
          sharpness.contrast !== null &&
          sharpness.contrast >= 12;
        return {
          index,
          src: source,
          alt: image.getAttribute('alt'),
          loading: image.getAttribute('loading'),
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
          top: Number(rect.top.toFixed(2)),
          left: Number(rect.left.toFixed(2)),
          right: Number(rect.right.toFixed(2)),
          bottom: Number(rect.bottom.toFixed(2)),
          selector: selectorFor(image),
          visibleToUser,
          renderedSuccessfully: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
          visibleRatio: Number(visibleRatio.toFixed(3)),
          visibleArea: Math.round(area),
          hasFallbackContent: hasFallbackContent(image),
          scaleX: Number(scaleX.toFixed(3)),
          scaleY: Number(scaleY.toFixed(3)),
          upscaleRatio: Number(upscaleRatio.toFixed(3)),
          isUpscaled: visibleToUser && !isVector && rect.width >= 32 && rect.height >= 32 && upscaleRatio > upscaleTolerance,
          isBlurry: blurEligible && sharpness.score! < blurThreshold,
          sharpness
        };
      });
    }, { blurThreshold, upscaleTolerance });
    const findings: ImageFinding[] = [];
    const issues: AuditIssue[] = [];
    const imageResponses = await mapWithConcurrency(
      imageData,
      auditConfig.apiValidationConcurrency,
      async (image) => {
        if (!image.src || /^(?:data|blob):/i.test(image.src)) return null;
        try {
          const r = await this.request.get(image.src, { timeout: 12_000, failOnStatusCode: false });
          const body = await r.body().catch(() => Buffer.from(''));
          return { response: r, body };
        } catch {
          return null;
        }
      }
    );

    // Cross-origin images taint a DOM canvas. Re-measure those assets from the already downloaded
    // bytes so CDN-hosted images receive the same quality analysis without weakening browser security.
    for (const [index, image] of imageData.entries()) {
      if (image.sharpness.score !== null) continue;
      const entry = imageResponses[index] as { response: any; body: Buffer } | null;
      const contentType = entry?.response?.headers()['content-type']?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (
        !entry?.body?.length ||
        entry.body.length > 5_000_000 ||
        !contentType.startsWith('image/') ||
        /(?:svg|gif)/i.test(contentType)
      ) continue;
      const measured = await this.measureDownloadedSharpness(page, entry.body, contentType).catch(() => null);
      if (!measured || measured.score === null || measured.contrast === null) continue;
      image.sharpness = { ...measured, score: measured.score, contrast: measured.contrast, reason: null };
      image.isBlurry =
        image.width >= 64 &&
        image.height >= 64 &&
        measured.contrast >= 12 &&
        measured.score < blurThreshold;
    }

    for (const [index, image] of imageData.entries()) {
      const imageFindings: ImageFinding[] = [];
      const addFinding = (
        failureType: string,
        severity: Severity,
        expected: string,
        actual: string,
        suggestedFix: string,
        details: Record<string, unknown> = image
      ): void => {
        imageFindings.push({
          pageUrl: url,
          imageUrl: image.src || undefined,
          selector: image.selector,
          failureType,
          severity,
          expected,
          actual,
          suggestedFix,
          details
        });
      };

      if (image.visibleToUser && !image.hasFallbackContent && !image.src) {
        addFinding(
          'Missing Image Source',
          'High',
          'The image has a resolvable src or srcset candidate.',
          'No image source was resolved by the browser.',
          'Provide a valid src or srcset URL and verify that the asset is deployed.'
        );
      }
      // check download/HTTP
      const respEntry = imageResponses[index] as { response: any; body: Buffer } | null;
      const response = respEntry?.response ?? null;
      const body = respEntry?.body ?? null;
      const browserRenderedSuccessfully = image.visibleToUser && image.renderedSuccessfully;

      if (image.visibleToUser && !image.hasFallbackContent && !browserRenderedSuccessfully && image.src && !/^(?:data|blob):/i.test(image.src)) {
        if (!response) {
          addFinding(
            'Image Request Failed',
            'High',
            'The visible image renders in the browser or the asset responds successfully.',
            `The browser did not confirm a rendered image and the audit request could not retrieve ${image.src}.`,
            'Verify the image URL, authentication rules, CDN availability, request policy, and browser rendering state.'
          );
        } else if (response.status() >= 400) {
          addFinding(
            `Image HTTP ${response.status()}`,
            'High',
            'The visible image renders in the browser or the asset returns an HTTP success status.',
            `The browser did not confirm a rendered image and the image request returned HTTP ${response.status()}.`,
            'Restore the missing asset or update the page to use a valid image URL.',
            { ...image, statusCode: response.status() }
          );
        } else if (!body || body.length === 0) {
          addFinding(
            'Empty Image Response',
            'High',
            'The visible image renders in the browser or the image response contains decodable image bytes.',
            'The browser did not confirm a rendered image and the image request returned an empty body.',
            'Fix the origin or CDN response so the image URL returns the complete asset.'
          );
        } else {
          // basic corruption check by magic numbers
          const header = body.slice(0, 8);
          const isPng = header.slice(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
          const isJpeg = header.slice(0,3).equals(Buffer.from([0xff,0xd8,0xff]));
          const isGif = header.slice(0,6).toString('ascii').startsWith('GIF89') || header.slice(0,6).toString('ascii').startsWith('GIF87');
          const isWebp = body.slice(0, 4).toString('ascii') === 'RIFF' && body.slice(8, 12).toString('ascii') === 'WEBP';
          const isSvg = body.slice(0, 512).toString('utf8').toLowerCase().includes('<svg');
          const isAvif = body.slice(4, 12).toString('ascii').includes('ftypavif');
          const contentType = response.headers()['content-type']?.toLowerCase() ?? '';
          if (!contentType.startsWith('image/') && !isPng && !isJpeg && !isGif && !isWebp && !isSvg && !isAvif) {
            addFinding(
              'Unrecognized Image Payload',
              'High',
              'The visible image renders in the browser or the image URL returns a recognized image media type or file signature.',
              `The browser did not confirm a rendered image; response content type was ${contentType || 'not provided'} and its signature was not recognized.`,
              'Verify that the asset URL returns an image rather than an HTML error page or corrupt payload.'
            );
          }
        }
      }

      // check rendering state in browser
      if (image.visibleToUser && !image.hasFallbackContent && !image.renderedSuccessfully) {
        addFinding(
          'Broken Image Rendering',
          'High',
          'Visible customer-facing images complete decoding with non-zero natural dimensions, or a visible fallback is shown.',
          `visibleToUser=${image.visibleToUser}; fallbackVisible=${image.hasFallbackContent}; complete=${image.complete}; natural size=${image.naturalWidth}x${image.naturalHeight}.`,
          'Verify the source, response format, decoding support, and load timing.'
        );
      }

      // lazy loading check: if loading lazy but image is in initial viewport and not rendered
      const likelyAboveFold = image.visibleToUser && image.top !== undefined && image.top < 900;
      if (image.loading === 'lazy' && likelyAboveFold && !image.hasFallbackContent && !image.renderedSuccessfully) {
        addFinding(
          'Failed Above-Fold Lazy Loading',
          'High',
          'An above-fold lazy image loads and decodes when it enters the viewport.',
          `The image is above the fold but complete=${image.complete} and naturalWidth=${image.naturalWidth}.`,
          'Do not defer critical above-fold imagery, or correct the lazy-loading observer and placeholder behavior.'
        );
      }

      if (image.isUpscaled) {
        addFinding(
          'Upscaled Image',
          'Medium',
          `The source image is at least as large as its ${image.width}x${image.height} CSS-pixel display size (within ${Math.round((upscaleTolerance - 1) * 100)}% tolerance).`,
          `Natural size ${image.naturalWidth}x${image.naturalHeight}; displayed size ${image.width}x${image.height}; maximum upscale ${image.upscaleRatio}x.`,
          'Serve a larger responsive source through srcset/sizes and avoid enlarging raster images beyond their natural dimensions.'
        );
      }

      if (image.isBlurry) {
        addFinding(
          'Blurry Image',
          'Medium',
          `Canvas sharpness score is at least ${blurThreshold} for a sufficiently detailed raster image.`,
          `Sharpness score ${image.sharpness.score}; contrast ${image.sharpness.contrast}; sampled at ${image.sharpness.sampledWidth}x${image.sharpness.sampledHeight}.`,
          'Replace the asset with a sharper export, reduce compression, and provide a correctly sized responsive source.'
        );
      }

      if (imageFindings.length > 0) {
        const locator = page.locator(image.selector).first();
        const shot = await evidence.captureLocator(`image-${image.index}`, locator).catch(() => null);
        for (const finding of imageFindings) finding.evidence = shot?.path;
      }
      findings.push(...imageFindings);
    }

    for (const finding of findings) {
      issues.push(
        createIssue({
          category: 'Images',
          targetName,
          url,
          viewport,
          selector: finding.selector,
          description: `${finding.failureType}: Image quality or delivery validation failed.`,
          severity: finding.severity ?? 'High',
          evidence: finding.evidence ? [finding.evidence] : [],
          expected: finding.expected ?? 'The image renders correctly and meets visual quality requirements.',
          actual: finding.actual ?? finding.failureType,
          suggestedFix: finding.suggestedFix ?? 'Verify the image source, rendering dimensions, CDN response, and accessible text.',
          timestamp: new Date().toISOString(),
          details: finding.details ?? finding
        })
      );
    }

    return { issues, findings };
  }

  private async waitForVisibleImageDecode(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const visibleImages = Array.from(document.images).filter((image) => {
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        return (
          rect.width >= 8 &&
          rect.height >= 8 &&
          visibleWidth * visibleHeight >= 64 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01
        );
      });
      await Promise.all(
        visibleImages.map((image) =>
          image.decode().catch(() => undefined)
        )
      );
    }).catch(() => undefined);
  }

  private async measureDownloadedSharpness(
    page: Page,
    body: Buffer,
    contentType: string
  ): Promise<{
    score: number | null;
    contrast: number | null;
    sampledWidth: number;
    sampledHeight: number;
    reason: string | null;
    source: string;
  }> {
    const dataUrl = `data:${contentType};base64,${body.toString('base64')}`;
    return page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const longestSide = 192;
      const scale = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
      const sampledWidth = Math.max(3, Math.round(image.naturalWidth * scale));
      const sampledHeight = Math.max(3, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = sampledWidth;
      canvas.height = sampledHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        return {
          score: null,
          contrast: null,
          sampledWidth,
          sampledHeight,
          reason: 'Canvas 2D context is unavailable.',
          source: 'downloaded-asset'
        };
      }
      context.drawImage(image, 0, 0, sampledWidth, sampledHeight);
      const pixels = context.getImageData(0, 0, sampledWidth, sampledHeight).data;
      const luminance = new Float32Array(sampledWidth * sampledHeight);
      let luminanceTotal = 0;
      let luminanceSquaredTotal = 0;
      for (let pixel = 0, position = 0; pixel < pixels.length; pixel += 4, position += 1) {
        const value = 0.2126 * pixels[pixel] + 0.7152 * pixels[pixel + 1] + 0.0722 * pixels[pixel + 2];
        luminance[position] = value;
        luminanceTotal += value;
        luminanceSquaredTotal += value * value;
      }

      let laplacianTotal = 0;
      let laplacianSquaredTotal = 0;
      let samples = 0;
      for (let y = 1; y < sampledHeight - 1; y += 1) {
        for (let x = 1; x < sampledWidth - 1; x += 1) {
          const position = y * sampledWidth + x;
          const laplacian =
            4 * luminance[position] -
            luminance[position - 1] -
            luminance[position + 1] -
            luminance[position - sampledWidth] -
            luminance[position + sampledWidth];
          laplacianTotal += laplacian;
          laplacianSquaredTotal += laplacian * laplacian;
          samples += 1;
        }
      }
      const pixelCount = luminance.length;
      const luminanceMean = luminanceTotal / pixelCount;
      const contrast = Math.sqrt(Math.max(0, luminanceSquaredTotal / pixelCount - luminanceMean * luminanceMean));
      const laplacianMean = laplacianTotal / Math.max(1, samples);
      const score = Math.max(0, laplacianSquaredTotal / Math.max(1, samples) - laplacianMean * laplacianMean);
      return {
        score: Number(score.toFixed(2)),
        contrast: Number(contrast.toFixed(2)),
        sampledWidth,
        sampledHeight,
        reason: null,
        source: 'downloaded-asset'
      };
    }, dataUrl);
  }
}
