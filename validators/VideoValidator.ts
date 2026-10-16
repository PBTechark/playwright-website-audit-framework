import { APIRequestContext, Page } from '@playwright/test';
import { auditConfig } from '../config/auditConfig';
import { recordAssertion } from '../utils/assertionFactory';
import { BrowserSignalCollector } from '../utils/browserSignals';
import { mapWithConcurrency } from '../utils/concurrency';
import { EvidenceManager } from '../utils/evidence';
import { AuditCheck, AuditIssue, ScreenshotEvidence, Severity, VideoFinding } from '../utils/types';

type Box = { x: number; y: number; width: number; height: number };

type VideoSourceSnapshot = {
  url: string;
  declaredType?: string;
  inferredType?: string;
  canPlayType: string;
  sourceKind: 'currentSrc' | 'video-src' | 'source';
};

type PlayControlSnapshot = {
  selector: string;
  visible: boolean;
  disabled: boolean;
  pointerEvents: string;
  label: string;
  box: Box | null;
};

type NativeVideoSnapshot = {
  index: number;
  selector: string;
  containerSelector?: string;
  userFacing: boolean;
  visible: boolean;
  hiddenReason?: string;
  clipped: boolean;
  clipReason?: string;
  box: Box | null;
  sourceCandidates: VideoSourceSnapshot[];
  poster?: string;
  controls: boolean;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  playsInline: boolean;
  readyState: number;
  networkState: number;
  paused: boolean;
  ended: boolean;
  currentTime: number;
  duration: number | null;
  videoWidth: number;
  videoHeight: number;
  errorCode?: number;
  errorMessage?: string;
  playControl?: PlayControlSnapshot;
  spinnerSelector?: string;
  spinnerVisible: boolean;
  posterOverlaySelector?: string;
  posterOverlayVisible: boolean;
};

type EmbeddedVideoSnapshot = {
  index: number;
  selector: string;
  provider: 'youtube' | 'vimeo';
  src: string;
  title?: string;
  visible: boolean;
  userFacing: boolean;
  clipped: boolean;
  clipReason?: string;
  box: Box | null;
};

type VideoDomSnapshot = {
  nativeVideos: NativeVideoSnapshot[];
  embeddedVideos: EmbeddedVideoSnapshot[];
};

type SourceCheck = {
  url: string;
  status?: number;
  contentType?: string;
  failureText?: string;
  responseOk: boolean;
};

type VideoState = {
  currentTime: number;
  duration: number | null;
  paused: boolean;
  ended: boolean;
  readyState: number;
  networkState: number;
  videoWidth: number;
  videoHeight: number;
  controls: boolean;
  errorCode?: number;
};

type FrameSample = {
  available: boolean;
  reason?: string;
  blackRatio?: number;
  meanLuminance?: number;
  signature?: number[];
};

type PlaybackObservation = {
  before: VideoState;
  afterClick: VideoState;
  mid: VideoState;
  final: VideoState;
  playButtonClicked: boolean;
  playButtonClickError?: string;
  directPlayAttempted: boolean;
  directPlayErrorName?: string;
  directPlayErrorMessage?: string;
  currentTimeAdvanced: boolean;
  stalled: boolean;
  frameChanged?: boolean;
  frameDifference?: number;
  firstFrame?: FrameSample;
  secondFrame?: FrameSample;
  finalSpinnerVisible?: boolean;
  finalPosterOverlayVisible?: boolean;
};

type CandidateSource = {
  playerType: 'native' | 'embedded';
  ownerSelector: string;
  url: string;
  declaredType?: string;
  inferredType?: string;
};

export class VideoValidator {
  constructor(private readonly request: APIRequestContext) {}

  async validate(
    page: Page,
    url: string,
    viewport: string,
    targetName = 'default',
    pageEvidence: string[] = [],
    signals?: BrowserSignalCollector
  ): Promise<{ checks: AuditCheck[]; issues: AuditIssue[]; findings: VideoFinding[]; screenshots: ScreenshotEvidence[] }> {
    const snapshot = await this.collectVideoDomSnapshot(page);
    if (snapshot.nativeVideos.length === 0 && snapshot.embeddedVideos.length === 0) {
      return { checks: [], issues: [], findings: [], screenshots: [] };
    }

    const checks: AuditCheck[] = [];
    const issues: AuditIssue[] = [];
    const findings: VideoFinding[] = [];
    const screenshots: ScreenshotEvidence[] = [];
    const evidenceManager = new EvidenceManager(page, url, viewport, targetName);
    const sourceChecks = await this.collectSourceChecks(page, snapshot);

    for (const video of snapshot.nativeVideos) {
      if (!video.userFacing) continue;
      const evidence = await this.captureEvidence(
        page,
        evidenceManager,
        video.selector,
        video.containerSelector,
        pageEvidence,
        `native-video-${video.index}`
      );
      screenshots.push(...evidence.screenshots);
      const evidencePaths = evidence.paths;
      const sourceDecision = this.nativeSourceDecision(video, sourceChecks, signals);
      const add = (input: {
        checkName: string;
        passed: boolean;
        severity: Severity;
        expected: string;
        actual: string;
        passComment: string;
        failComment: string;
        recommendation: string;
        details?: Record<string, unknown>;
        responseStatus?: number;
        videoUrl?: string;
      }): void => {
        const recorded = recordAssertion({
          component: 'Video',
          checkName: input.checkName,
          passed: input.passed,
          severity: input.severity,
          url,
          viewport,
          expected: input.expected,
          actual: input.actual,
          passComment: input.passComment,
          failComment: input.failComment,
          recommendation: input.recommendation,
          selector: video.selector,
          evidence: evidencePaths,
          boundingBox: video.box,
          responseStatus: input.responseStatus,
          consoleLogs: this.signalTextsFor(signals, input.videoUrl ?? sourceDecision.primaryUrl).slice(0, 10),
          details: {
            playerType: 'native',
            targetName,
            ...input.details
          }
        });
        checks.push(recorded.check);
        if (recorded.issue) {
          issues.push(recorded.issue);
          findings.push({
            pageUrl: url,
            videoUrl: input.videoUrl ?? sourceDecision.primaryUrl,
            selector: video.selector,
            playerType: 'native',
            failureType: input.checkName,
            severity: input.severity,
            expected: input.expected,
            actual: input.actual,
            suggestedFix: input.recommendation,
            evidence: evidencePaths[0],
            details: input.details
          });
        }
      };

      add({
        checkName: 'Video source presence',
        passed: video.sourceCandidates.length > 0,
        severity: 'High',
        expected: 'The visible video player has at least one playable source URL.',
        actual: video.sourceCandidates.length > 0
          ? `${video.sourceCandidates.length} source candidate(s): ${video.sourceCandidates.map((item) => item.url).join(', ')}`
          : 'No src, currentSrc, or <source src> candidate was found.',
        passComment: 'The video player exposes a source candidate for playback.',
        failComment: 'Missing Video Source: The player is visible to users but does not expose a video file to load.',
        recommendation: 'Add a valid video src or <source> URL and verify that the media asset is deployed.',
        details: { video }
      });

      if (!video.visible) {
        add({
          checkName: 'Video hidden by CSS',
          passed: false,
          severity: 'High',
          expected: 'The user-facing video player is visible with non-zero dimensions.',
          actual: video.hiddenReason ?? 'The video is not visibly rendered.',
          passComment: 'The video is visible.',
          failComment: 'Video Hidden By CSS: The video is in a user-facing media area but is hidden or has no visible size.',
          recommendation: 'Correct display, visibility, opacity, dimensions, or responsive CSS so users can see the player.',
          details: { video }
        });
        continue;
      }

      if (video.clipped) {
        add({
          checkName: 'Video clipped or partially hidden',
          passed: false,
          severity: 'Medium',
          expected: 'The visible video player remains fully inside the layout viewport and is not clipped.',
          actual: video.clipReason ?? 'The video is partially outside the visible viewport.',
          passComment: 'The video is fully visible.',
          failComment: 'Video Clipped: The player is visible but part of the video area is cut off or outside the viewport.',
          recommendation: 'Constrain the media container, remove fixed widths, and avoid overflow clipping at this breakpoint.',
          details: { video }
        });
      }

      const brokenSource = sourceDecision.brokenPrimary ?? sourceDecision.allBrokenSource;
      if (brokenSource) {
        add({
          checkName: 'Broken Video URL',
          passed: false,
          severity: this.primarySeverity(video),
          expected: 'The video source returns a successful media response.',
          actual: `${brokenSource.url} returned HTTP ${brokenSource.status}.`,
          passComment: 'The video source returns a successful response.',
          failComment: `Broken Video URL: The video file requested by this player returned HTTP ${brokenSource.status}, so users cannot play the media.`,
          recommendation: 'Restore the missing video file, correct the source URL, or update the CMS/media reference to a valid asset.',
          responseStatus: brokenSource.status,
          videoUrl: brokenSource.url,
          details: { video, sourceChecks: sourceDecision.checks }
        });
      }

      if (sourceDecision.incorrectMime) {
        add({
          checkName: 'Incorrect Video MIME Type',
          passed: false,
          severity: 'High',
          expected: 'The video asset responds with a browser-compatible video MIME type.',
          actual: `${sourceDecision.incorrectMime.url} responded with ${sourceDecision.incorrectMime.contentType || 'no content type'}.`,
          passComment: 'The video source MIME type is compatible with browser playback.',
          failComment: 'Incorrect Video MIME Type: The video URL responds with a non-video content type, so the browser may not play it.',
          recommendation: 'Serve the media with the correct Content-Type header, such as video/mp4 or video/webm, and avoid HTML error responses at media URLs.',
          responseStatus: sourceDecision.incorrectMime.status,
          videoUrl: sourceDecision.incorrectMime.url,
          details: { video, sourceChecks: sourceDecision.checks }
        });
      }

      if (sourceDecision.unsupportedCodec) {
        add({
          checkName: 'Browser codec unsupported',
          passed: false,
          severity: 'High',
          expected: 'At least one declared or detected video source type is playable by the browser.',
          actual: sourceDecision.unsupportedCodec,
          passComment: 'The browser can play at least one provided video format.',
          failComment: 'Browser Codec Unsupported: The browser reports that the supplied video format cannot be played.',
          recommendation: 'Provide a browser-supported encoding such as H.264 MP4 and add alternate <source> formats where needed.',
          details: { video, sourceChecks: sourceDecision.checks }
        });
      }

      const corsFailure = this.corsFailureFor(signals, sourceDecision.primaryUrl);
      if (corsFailure) {
        add({
          checkName: 'CORS Playback Failure',
          passed: false,
          severity: 'High',
          expected: 'The video source is allowed to load and play in the audited browser context.',
          actual: corsFailure,
          passComment: 'No CORS media playback failure was detected for this video.',
          failComment: 'CORS Playback Failure: Browser security blocked the video request, preventing playback for users.',
          recommendation: 'Fix CORS headers, CDN media rules, or cross-origin attributes so the browser is allowed to load the video.',
          details: { video, sourceChecks: sourceDecision.checks, matchingSignals: this.signalTextsFor(signals, sourceDecision.primaryUrl) }
        });
      }

      const playControl = video.playControl;
      const hasVisibleManualControl = video.controls || Boolean(playControl?.visible);
      if (playControl?.visible && playControl.disabled) {
        add({
          checkName: 'Play Button Disabled',
          passed: false,
          severity: 'High',
          expected: 'The visible play control is enabled when video playback is available.',
          actual: `disabled=${playControl.disabled}, pointerEvents=${playControl.pointerEvents}, label=${playControl.label || '(empty)'}.`,
          passComment: 'The play control is enabled.',
          failComment: 'Play Button Disabled: Users can see the play control, but it is disabled.',
          recommendation: 'Enable the play control when the media source is ready, or hide the player until playback is available.',
          details: { video, playControl }
        });
      }

      const sourceBlocking = !video.sourceCandidates.length ||
        Boolean(brokenSource || sourceDecision.incorrectMime || sourceDecision.unsupportedCodec || corsFailure);
      if (!sourceBlocking && !hasVisibleManualControl && !video.autoplay && video.paused) {
        add({
          checkName: 'Controls Not Available',
          passed: false,
          severity: 'High',
          expected: 'A visible user-facing video exposes native controls, a custom play button, or starts automatically.',
          actual: 'No native controls, visible play button, or autoplay behavior was found.',
          passComment: 'The player exposes a usable playback path.',
          failComment: 'Controls Not Available: Users can see the video area but have no visible way to start playback.',
          recommendation: 'Add native controls, provide an accessible play button, or start the media automatically only when appropriate.',
          details: { video }
        });
      }

      if (sourceBlocking || playControl?.disabled) continue;

      const observation = await this.observeNativeVideo(page, video.selector, playControl?.selector, video.spinnerSelector, video.posterOverlaySelector);
      const neverStarted = !observation.currentTimeAdvanced && !observation.final.ended;
      if (neverStarted) {
        const autoplayBlocked = video.autoplay &&
          /notallowed|user gesture|interact|permission/i.test(`${observation.directPlayErrorName ?? ''} ${observation.directPlayErrorMessage ?? ''}`) &&
          !hasVisibleManualControl;
        add({
          checkName: autoplayBlocked ? 'Video Autoplay Blocked' : playControl?.visible ? 'Play Button Not Responding' : 'Video Never Starts',
          passed: false,
          severity: autoplayBlocked ? 'Medium' : 'High',
          expected: autoplayBlocked
            ? 'An autoplay video either starts automatically or exposes a visible manual play control.'
            : 'The visible video starts playback and currentTime advances after a play attempt.',
          actual: this.playbackActual(observation),
          passComment: 'The video started playback.',
          failComment: autoplayBlocked
            ? 'Autoplay Blocked: The browser blocked autoplay and users were not given a visible manual play path.'
            : playControl?.visible
              ? 'Play Button Not Responding: The visible play control was clicked, but the video did not start and currentTime did not advance.'
              : 'Video Never Starts: Playback was attempted, but the video did not start.',
          recommendation: autoplayBlocked
            ? 'Mute autoplay media or provide a visible accessible play button so users can start playback intentionally.'
            : 'Fix the player click handler, blocking overlay, media initialization, or video source so playback starts when requested.',
          details: { video, observation }
        });
      }

      if (observation.stalled) {
        add({
          checkName: 'Video Stalled During Playback',
          passed: false,
          severity: 'High',
          expected: 'After playback starts, currentTime continues to advance during the observation window.',
          actual: this.playbackActual(observation),
          passComment: 'The video continued advancing during observation.',
          failComment: 'Video Stalled During Playback: The video started, then stopped advancing during the observation window.',
          recommendation: 'Check streaming/CDN availability, buffering behavior, media encoding, and player error handling.',
          details: { video, observation }
        });
      }

      if (this.isBlackFrame(observation.secondFrame)) {
        add({
          checkName: 'Black Video Frame',
          passed: false,
          severity: 'High',
          expected: 'The visible video area renders meaningful video content after playback starts.',
          actual: `Frame sample remained mostly black: ${JSON.stringify(observation.secondFrame)}.`,
          passComment: 'The sampled video frame contains visible content.',
          failComment: 'Black Video Frame: The player is visible and playback was attempted, but the video area remained mostly black.',
          recommendation: 'Verify the encoded video track, poster overlay, player initialization, and browser-supported codec.',
          details: { video, observation }
        });
      } else if (this.isFrozenFrame(observation)) {
        add({
          checkName: 'Audio Plays But Video Is Frozen',
          passed: false,
          severity: 'High',
          expected: 'Visible video frames change while the playback timeline advances.',
          actual: `currentTime advanced but frame difference was ${observation.frameDifference}.`,
          passComment: 'Video frames changed while playback advanced.',
          failComment: 'Audio Plays But Video Is Frozen: The playback timeline advanced, but sampled video frames did not visibly change.',
          recommendation: 'Re-encode the media, verify the video track, and check player rendering issues that freeze frames while audio/timeline continues.',
          details: { video, observation }
        });
      }

      if (video.controls && !observation.final.controls) {
        add({
          checkName: 'Controls Disappear',
          passed: false,
          severity: 'Medium',
          expected: 'Native controls remain available for a user-facing video when controls are enabled.',
          actual: 'The controls attribute was present before playback but absent after the playback attempt.',
          passComment: 'Video controls remain available.',
          failComment: 'Controls Disappear: The player removed its controls after playback started, leaving users without expected playback controls.',
          recommendation: 'Keep native controls enabled or replace them with stable, accessible custom controls.',
          details: { video, observation }
        });
      }

      if (observation.finalSpinnerVisible && (neverStarted || observation.final.readyState < 3)) {
        add({
          checkName: 'Infinite Loading Spinner',
          passed: false,
          severity: 'High',
          expected: 'Loading indicators disappear once the video becomes playable or an error is shown.',
          actual: `Spinner ${video.spinnerSelector ?? '(unknown)'} remained visible; readyState=${observation.final.readyState}.`,
          passComment: 'No stuck loading spinner was detected.',
          failComment: 'Infinite Loading Spinner: The loading indicator stayed visible and the video did not become clearly playable.',
          recommendation: 'Handle media load failures, hide loading indicators after error states, and show a clear fallback message.',
          details: { video, observation }
        });
      }

      if (observation.finalPosterOverlayVisible && (observation.currentTimeAdvanced || observation.directPlayAttempted || observation.playButtonClicked)) {
        add({
          checkName: 'Poster Image Stuck',
          passed: false,
          severity: 'High',
          expected: 'Poster or thumbnail overlays disappear once playback is requested.',
          actual: `Poster overlay ${video.posterOverlaySelector ?? '(unknown)'} remained visible after the playback attempt.`,
          passComment: 'The poster overlay cleared after playback was requested.',
          failComment: 'Poster Image Stuck: Playback was attempted, but the poster/overlay remained visible and prevented users from seeing the video.',
          recommendation: 'Remove or hide poster overlays on play, and ensure overlay z-index does not cover the playing video.',
          details: { video, observation }
        });
      }
    }

    for (const embed of snapshot.embeddedVideos) {
      if (!embed.userFacing) continue;
      const evidence = await this.captureEvidence(
        page,
        evidenceManager,
        embed.selector,
        undefined,
        pageEvidence,
        `${embed.provider}-iframe-${embed.index}`
      );
      screenshots.push(...evidence.screenshots);
      const evidencePaths = evidence.paths;
      const embedCheck = sourceChecks.get(embed.src);
      const add = (input: {
        checkName: string;
        passed: boolean;
        severity: Severity;
        expected: string;
        actual: string;
        passComment: string;
        failComment: string;
        recommendation: string;
        details?: Record<string, unknown>;
        responseStatus?: number;
      }): void => {
        const recorded = recordAssertion({
          component: 'Video',
          checkName: input.checkName,
          passed: input.passed,
          severity: input.severity,
          url,
          viewport,
          expected: input.expected,
          actual: input.actual,
          passComment: input.passComment,
          failComment: input.failComment,
          recommendation: input.recommendation,
          selector: embed.selector,
          evidence: evidencePaths,
          boundingBox: embed.box,
          responseStatus: input.responseStatus,
          consoleLogs: this.signalTextsFor(signals, embed.src).slice(0, 10),
          details: {
            playerType: 'embedded',
            targetName,
            provider: embed.provider,
            ...input.details
          }
        });
        checks.push(recorded.check);
        if (recorded.issue) {
          issues.push(recorded.issue);
          findings.push({
            pageUrl: url,
            videoUrl: embed.src,
            selector: embed.selector,
            playerType: 'embedded',
            failureType: input.checkName,
            severity: input.severity,
            expected: input.expected,
            actual: input.actual,
            suggestedFix: input.recommendation,
            evidence: evidencePaths[0],
            details: input.details
          });
        }
      };

      add({
        checkName: 'Embedded video source presence',
        passed: embed.src.length > 0,
        severity: 'High',
        expected: 'The embedded video iframe has a non-empty YouTube or Vimeo source URL.',
        actual: embed.src || 'No iframe src was found.',
        passComment: 'The embedded video exposes a source URL.',
        failComment: 'Missing Video Source: The embedded player has no source URL.',
        recommendation: 'Set the iframe src to a valid YouTube or Vimeo embed URL.',
        details: { embed }
      });

      if (!embed.visible) {
        add({
          checkName: 'Video hidden by CSS',
          passed: false,
          severity: 'High',
          expected: 'The embedded video iframe is visible with non-zero dimensions.',
          actual: 'The iframe is hidden, transparent, or has no visible size.',
          passComment: 'The embedded player is visible.',
          failComment: 'Video Hidden By CSS: The embedded player is present but not visible to users.',
          recommendation: 'Correct iframe dimensions, display, visibility, opacity, or responsive CSS.',
          details: { embed }
        });
      }

      if (embed.clipped) {
        add({
          checkName: 'Video clipped or partially hidden',
          passed: false,
          severity: 'Medium',
          expected: 'The embedded player is fully visible inside the viewport.',
          actual: embed.clipReason ?? 'The iframe is partially outside the visible viewport.',
          passComment: 'The embedded player is fully visible.',
          failComment: 'Video Clipped: The embedded player is partially cut off or outside the viewport.',
          recommendation: 'Adjust responsive iframe sizing and parent overflow rules so the full player is visible.',
          details: { embed }
        });
      }

      if (embedCheck?.status && embedCheck.status >= 400) {
        add({
          checkName: 'Embedded Video Failed To Load',
          passed: false,
          severity: 'High',
          expected: 'The embedded video iframe URL returns a successful response.',
          actual: `${embed.src} returned HTTP ${embedCheck.status}.`,
          passComment: 'The embedded video URL responds successfully.',
          failComment: `Embedded Video Failed To Load: The ${embed.provider} player URL returned HTTP ${embedCheck.status}.`,
          recommendation: 'Verify the embedded video ID, provider URL, privacy settings, and iframe embed configuration.',
          responseStatus: embedCheck.status,
          details: { embed, sourceCheck: embedCheck }
        });
      }

      const blockedSignal = this.embeddedBlockedSignal(signals, embed.src);
      if (blockedSignal) {
        add({
          checkName: 'Embedded Video Failed To Load',
          passed: false,
          severity: 'High',
          expected: 'The embedded player is allowed by browser security policy and loads in the page.',
          actual: blockedSignal,
          passComment: 'No browser security error was detected for the embedded player.',
          failComment: 'Embedded Video Failed To Load: Browser security or provider restrictions blocked the embedded player.',
          recommendation: 'Review CSP, X-Frame-Options, provider privacy settings, iframe permissions, and allowed embed domains.',
          details: { embed, matchingSignals: this.signalTextsFor(signals, embed.src) }
        });
      }
    }

    return { checks, issues, findings, screenshots };
  }

  private async collectSourceChecks(page: Page, snapshot: VideoDomSnapshot): Promise<Map<string, SourceCheck>> {
    const candidates: CandidateSource[] = [
      ...snapshot.nativeVideos.flatMap((video) =>
        video.sourceCandidates.map((source) => ({
          playerType: 'native' as const,
          ownerSelector: video.selector,
          url: source.url,
          declaredType: source.declaredType,
          inferredType: source.inferredType
        }))
      ),
      ...snapshot.embeddedVideos.map((embed) => ({
        playerType: 'embedded' as const,
        ownerSelector: embed.selector,
        url: embed.src
      }))
    ].filter((source, index, all) =>
      source.url.length > 0 &&
      !/^(?:data|blob|about):/i.test(source.url) &&
      all.findIndex((candidate) => candidate.url === source.url) === index
    );

    const checks = await mapWithConcurrency(
      candidates,
      auditConfig.apiValidationConcurrency,
      async (source) => this.checkSource(source.url)
    );

    const contentTypes = checks
      .map((check) => check.contentType)
      .filter((contentType): contentType is string => Boolean(contentType));
    const canPlayByType = await this.canPlayTypes(page, contentTypes);
    for (const check of checks) {
      if (check.contentType && canPlayByType[check.contentType] !== undefined) {
        check.responseOk = check.responseOk && (this.isLikelyVideoMime(check.contentType) || canPlayByType[check.contentType] !== '');
      }
    }

    return new Map(checks.map((check) => [check.url, check]));
  }

  private async checkSource(sourceUrl: string): Promise<SourceCheck> {
    try {
      const response = await this.request.get(sourceUrl, {
        timeout: 12_000,
        failOnStatusCode: false,
        headers: { Range: 'bytes=0-0' }
      });
      const contentType = response.headers()['content-type']?.split(';')[0]?.trim().toLowerCase();
      return {
        url: sourceUrl,
        status: response.status(),
        contentType,
        responseOk: response.status() < 400
      };
    } catch (error) {
      return {
        url: sourceUrl,
        failureText: error instanceof Error ? error.message : String(error),
        responseOk: false
      };
    }
  }

  private nativeSourceDecision(
    video: NativeVideoSnapshot,
    sourceChecks: Map<string, SourceCheck>,
    signals?: BrowserSignalCollector
  ): {
    primaryUrl?: string;
    checks: SourceCheck[];
    brokenPrimary?: SourceCheck;
    allBrokenSource?: SourceCheck;
    incorrectMime?: SourceCheck;
    unsupportedCodec?: string;
  } {
    const primaryUrl = video.sourceCandidates.find((source) => source.sourceKind === 'currentSrc')?.url ??
      video.sourceCandidates[0]?.url;
    const checks = video.sourceCandidates
      .map((source) => sourceChecks.get(source.url))
      .filter((check): check is SourceCheck => Boolean(check));
    const checkedFailures = checks.filter((check) => check.status !== undefined && check.status >= 400);
    const brokenPrimary = primaryUrl
      ? checks.find((check) => check.url === primaryUrl && check.status !== undefined && check.status >= 400)
      : undefined;
    const allBrokenSource = checks.length > 0 && checks.every((check) => check.status !== undefined && check.status >= 400)
      ? checkedFailures[0]
      : undefined;
    const incorrectMime = checks.find((check) =>
      check.status !== undefined &&
      check.status < 400 &&
      Boolean(check.contentType) &&
      !this.isLikelyVideoMime(check.contentType!)
    );
    const typedSources = video.sourceCandidates.filter((source) => source.declaredType || source.inferredType);
    const allDeclaredUnsupported = typedSources.length > 0 &&
      typedSources.every((source) => source.canPlayType === '');
    const browserMediaErrorUnsupported = video.errorCode === 4;
    const signalUnsupported = this.signalTextsFor(signals, primaryUrl).some((text) =>
      /unsupported|codec|media_err_src_not_supported|no supported source/i.test(text)
    );
    const unsupportedCodec = browserMediaErrorUnsupported || allDeclaredUnsupported || signalUnsupported
      ? `errorCode=${video.errorCode ?? 'none'}; source support=${typedSources.map((source) => `${source.declaredType ?? source.inferredType}:${source.canPlayType || 'not supported'}`).join(', ') || 'not declared'}`
      : undefined;

    return { primaryUrl, checks, brokenPrimary, allBrokenSource, incorrectMime, unsupportedCodec };
  }

  private async collectVideoDomSnapshot(page: Page): Promise<VideoDomSnapshot> {
    return page.evaluate(() => {
      type B = { x: number; y: number; width: number; height: number };
      const selectorFor = (element: Element): string => {
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
      const boxFor = (element: Element): B | null => {
        const rect = element.getBoundingClientRect();
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
        return {
          x: Number(rect.x.toFixed(2)),
          y: Number(rect.y.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2))
        };
      };
      const isVisible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 2 &&
          rect.height > 2 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01 &&
          !element.closest('[hidden],template,script,style,[aria-hidden="true"]');
      };
      const hiddenReason = (element: Element): string | undefined => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (element.closest('[hidden],template,script,style,[aria-hidden="true"]')) return 'The video or an ancestor is hidden from users.';
        if (style.display === 'none') return 'display is none.';
        if (style.visibility === 'hidden') return 'visibility is hidden.';
        if (Number(style.opacity) <= 0.01) return `opacity=${style.opacity}.`;
        if (rect.width <= 2 || rect.height <= 2) return `rendered size is ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}.`;
        return undefined;
      };
      const clipping = (element: Element): { clipped: boolean; reason?: string } => {
        const rect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const style = getComputedStyle(element);
        if (style.clipPath !== 'none' || style.clip !== 'auto') {
          return { clipped: true, reason: `clip=${style.clip}; clipPath=${style.clipPath}.` };
        }
        if (rect.left < -8 || rect.top < -8 || rect.right > viewportWidth + 8 || rect.bottom > viewportHeight + 8) {
          return {
            clipped: true,
            reason: `box=${rect.left.toFixed(1)},${rect.top.toFixed(1)},${rect.right.toFixed(1)},${rect.bottom.toFixed(1)}; viewport=${viewportWidth}x${viewportHeight}.`
          };
        }
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const parentStyle = getComputedStyle(parent);
          const clips = ['hidden', 'clip'].includes(parentStyle.overflow) ||
            ['hidden', 'clip'].includes(parentStyle.overflowX) ||
            ['hidden', 'clip'].includes(parentStyle.overflowY);
          if (clips) {
            const parentRect = parent.getBoundingClientRect();
            if (
              rect.left < parentRect.left - 2 ||
              rect.top < parentRect.top - 2 ||
              rect.right > parentRect.right + 2 ||
              rect.bottom > parentRect.bottom + 2
            ) {
              return { clipped: true, reason: `Ancestor ${selectorFor(parent)} clips the media area with overflow rules.` };
            }
          }
          parent = parent.parentElement;
        }
        return { clipped: false };
      };
      const mediaIntent = (element: Element): boolean => {
        const container = element.closest<HTMLElement>(
          '[data-video],[data-player],[class*="video" i],[id*="video" i],[class*="player" i],[id*="player" i],[class*="media" i],[id*="media" i],[class*="hero" i],[id*="hero" i],[class*="embed" i],[id*="embed" i],figure,section,article'
        );
        const text = `${element.id} ${element.className} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${container?.id ?? ''} ${container?.className ?? ''}`;
        return /video|player|media|hero|banner|embed|youtube|vimeo|watch|story|feature|demo|trailer/i.test(text);
      };
      const nearestContainer = (element: Element): HTMLElement | null =>
        element.parentElement?.closest<HTMLElement>(
          '[data-video],[data-player],[class*="video" i],[id*="video" i],[class*="player" i],[id*="player" i],[class*="media" i],[id*="media" i],figure,section,article,div'
        ) ?? null;
      const overlaps = (first: DOMRect, second: DOMRect): boolean =>
        Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left)) *
          Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)) > 25;
      const visibleNear = (root: Element | Document, mediaRect: DOMRect, selector: string): HTMLElement | undefined =>
        Array.from(root.querySelectorAll<HTMLElement>(selector)).find((candidate) =>
          isVisible(candidate) && overlaps(candidate.getBoundingClientRect(), mediaRect)
        );
      const inferType = (sourceUrl: string): string | undefined => {
        const lower = sourceUrl.split(/[?#]/)[0].toLowerCase();
        if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
        if (lower.endsWith('.webm')) return 'video/webm';
        if (lower.endsWith('.ogv') || lower.endsWith('.ogg')) return 'video/ogg';
        if (lower.endsWith('.mov')) return 'video/quicktime';
        if (lower.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
        if (lower.endsWith('.mpd')) return 'application/dash+xml';
        return undefined;
      };
      const mediaProbe = document.createElement('video');
      const sourceFor = (video: HTMLVideoElement): VideoSourceSnapshot[] => {
        const out: VideoSourceSnapshot[] = [];
        const push = (url: string, declaredType: string | null | undefined, sourceKind: VideoSourceSnapshot['sourceKind']) => {
          const normalized = url.trim();
          if (!normalized) return;
          const inferredType = inferType(normalized);
          const type = declaredType?.trim() || inferredType;
          if (out.some((item) => item.url === normalized)) return;
          out.push({
            url: normalized,
            declaredType: declaredType?.trim() || undefined,
            inferredType,
            canPlayType: type ? mediaProbe.canPlayType(type) : '',
            sourceKind
          });
        };
        push(video.currentSrc, null, 'currentSrc');
        push(video.src || video.getAttribute('src') || '', null, 'video-src');
        for (const source of Array.from(video.querySelectorAll<HTMLSourceElement>('source'))) {
          push(source.src || source.getAttribute('src') || '', source.type || source.getAttribute('type'), 'source');
        }
        return out;
      };
      const playControlFor = (video: HTMLVideoElement): PlayControlSnapshot | undefined => {
        const mediaRect = video.getBoundingClientRect();
        const root = nearestContainer(video) ?? document;
        const candidate = visibleNear(
          root,
          mediaRect,
          [
            'button',
            '[role="button"]',
            'a[aria-label*="play" i]',
            '[aria-label*="play" i]',
            '[title*="play" i]',
            '[class*="play" i]',
            '[id*="play" i]'
          ].join(',')
        );
        if (!candidate) return undefined;
        const style = getComputedStyle(candidate);
        const input = candidate as HTMLButtonElement | HTMLInputElement;
        const disabled = Boolean(input.disabled) || candidate.getAttribute('aria-disabled') === 'true';
        return {
          selector: selectorFor(candidate),
          visible: isVisible(candidate),
          disabled,
          pointerEvents: style.pointerEvents,
          label: (candidate.innerText || candidate.getAttribute('aria-label') || candidate.getAttribute('title') || input.value || '').trim(),
          box: boxFor(candidate)
        };
      };
      const spinnerFor = (element: Element): HTMLElement | undefined => {
        const mediaRect = element.getBoundingClientRect();
        const root = nearestContainer(element) ?? document;
        return visibleNear(
          root,
          mediaRect,
          '[class*="spinner" i],[class*="loader" i],[class*="loading" i],[aria-busy="true"],progress'
        );
      };
      const posterOverlayFor = (element: Element): HTMLElement | undefined => {
        const mediaRect = element.getBoundingClientRect();
        const root = nearestContainer(element) ?? document;
        return visibleNear(
          root,
          mediaRect,
          '[class*="poster" i],[id*="poster" i],[class*="thumbnail" i],[id*="thumbnail" i],[class*="cover" i],[id*="cover" i]'
        );
      };

      const nativeVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('video')).map((video, index): NativeVideoSnapshot => {
        const container = nearestContainer(video);
        const visible = isVisible(video);
        const clip = clipping(video);
        const sources = sourceFor(video);
        const spinner = spinnerFor(video);
        const posterOverlay = posterOverlayFor(video);
        const containerVisible = container ? isVisible(container) : false;
        return {
          index,
          selector: selectorFor(video),
          containerSelector: container ? selectorFor(container) : undefined,
          userFacing: visible || containerVisible || video.controls || Boolean(video.poster) || video.autoplay || mediaIntent(video),
          visible,
          hiddenReason: hiddenReason(video),
          clipped: clip.clipped,
          clipReason: clip.reason,
          box: boxFor(video),
          sourceCandidates: sources,
          poster: video.poster || video.getAttribute('poster') || undefined,
          controls: video.controls,
          autoplay: video.autoplay,
          muted: video.muted,
          loop: video.loop,
          playsInline: video.playsInline,
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          ended: video.ended,
          currentTime: Number(video.currentTime.toFixed(3)),
          duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : null,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          errorCode: video.error?.code,
          errorMessage: video.error?.message,
          playControl: playControlFor(video),
          spinnerSelector: spinner ? selectorFor(spinner) : undefined,
          spinnerVisible: Boolean(spinner),
          posterOverlaySelector: posterOverlay ? selectorFor(posterOverlay) : undefined,
          posterOverlayVisible: Boolean(posterOverlay)
        };
      });

      const embeddedVideos = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))
        .map((iframe, index) => ({ iframe, index, src: iframe.src || iframe.getAttribute('src') || '' }))
        .filter(({ src }) => /(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com)/i.test(src))
        .map(({ iframe, index, src }): EmbeddedVideoSnapshot => {
          const visible = isVisible(iframe);
          const clip = clipping(iframe);
          return {
            index,
            selector: selectorFor(iframe),
            provider: /vimeo\.com/i.test(src) ? 'vimeo' : 'youtube',
            src,
            title: iframe.title || iframe.getAttribute('aria-label') || undefined,
            visible,
            userFacing: visible || mediaIntent(iframe),
            clipped: clip.clipped,
            clipReason: clip.reason,
            box: boxFor(iframe)
          };
        });

      return { nativeVideos, embeddedVideos };
    });
  }

  private async observeNativeVideo(
    page: Page,
    selector: string,
    playButtonSelector?: string,
    spinnerSelector?: string,
    posterOverlaySelector?: string
  ): Promise<PlaybackObservation> {
    return page.evaluate(async ({ selector, playButtonSelector, spinnerSelector, posterOverlaySelector }) => {
      type State = {
        currentTime: number;
        duration: number | null;
        paused: boolean;
        ended: boolean;
        readyState: number;
        networkState: number;
        videoWidth: number;
        videoHeight: number;
        controls: boolean;
        errorCode?: number;
      };
      type Sample = {
        available: boolean;
        reason?: string;
        blackRatio?: number;
        meanLuminance?: number;
        signature?: number[];
      };
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      const video = document.querySelector<HTMLVideoElement>(selector);
      if (!video) {
        const emptyState: State = {
          currentTime: 0,
          duration: null,
          paused: true,
          ended: false,
          readyState: 0,
          networkState: 0,
          videoWidth: 0,
          videoHeight: 0,
          controls: false
        };
        return {
          before: emptyState,
          afterClick: emptyState,
          mid: emptyState,
          final: emptyState,
          playButtonClicked: false,
          directPlayAttempted: false,
          currentTimeAdvanced: false,
          stalled: false
        };
      }
      const state = (): State => ({
        currentTime: Number(video.currentTime.toFixed(3)),
        duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : null,
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        networkState: video.networkState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        controls: video.controls,
        errorCode: video.error?.code
      });
      const visible = (element: Element | null): boolean => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 2 &&
          rect.height > 2 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01;
      };
      const sampleFrame = (): Sample => {
        if (video.videoWidth < 2 || video.videoHeight < 2 || video.readyState < 2) {
          return { available: false, reason: `No drawable frame: readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}.` };
        }
        try {
          const width = 48;
          const height = Math.max(24, Math.round(width * (video.videoHeight / Math.max(1, video.videoWidth))));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return { available: false, reason: 'Canvas 2D context unavailable.' };
          context.drawImage(video, 0, 0, width, height);
          const data = context.getImageData(0, 0, width, height).data;
          let black = 0;
          let luminanceTotal = 0;
          const signature: number[] = [];
          const cellWidth = Math.max(1, Math.floor(width / 6));
          const cellHeight = Math.max(1, Math.floor(height / 4));
          const cellTotals = new Array(24).fill(0) as number[];
          const cellCounts = new Array(24).fill(0) as number[];
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const offset = (y * width + x) * 4;
              const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
              luminanceTotal += luminance;
              if (luminance < 12) black += 1;
              const cellX = Math.min(5, Math.floor(x / cellWidth));
              const cellY = Math.min(3, Math.floor(y / cellHeight));
              const cell = cellY * 6 + cellX;
              cellTotals[cell] += luminance;
              cellCounts[cell] += 1;
            }
          }
          for (let index = 0; index < cellTotals.length; index += 1) {
            signature.push(Number((cellTotals[index] / Math.max(1, cellCounts[index])).toFixed(1)));
          }
          const pixels = width * height;
          return {
            available: true,
            blackRatio: Number((black / pixels).toFixed(3)),
            meanLuminance: Number((luminanceTotal / pixels).toFixed(2)),
            signature
          };
        } catch (error) {
          return {
            available: false,
            reason: error instanceof Error ? error.message : String(error)
          };
        }
      };

      video.scrollIntoView({ block: 'center', inline: 'center' });
      const before = state();
      let playButtonClicked = false;
      let playButtonClickError: string | undefined;
      const button = playButtonSelector ? document.querySelector<HTMLElement>(playButtonSelector) : null;
      if (button && visible(button)) {
        try {
          button.click();
          playButtonClicked = true;
        } catch (error) {
          playButtonClickError = error instanceof Error ? error.message : String(error);
        }
      }
      await wait(900);
      const afterClick = state();

      const originalMuted = video.muted;
      let directPlayAttempted = false;
      let directPlayErrorName: string | undefined;
      let directPlayErrorMessage: string | undefined;
      if (video.paused && !video.ended) {
        directPlayAttempted = true;
        try {
          video.muted = true;
          await Promise.race([
            video.play(),
            new Promise((_resolve, reject) => setTimeout(() => reject(new Error('play() timed out')), 1800))
          ]);
        } catch (error) {
          directPlayErrorName = error instanceof DOMException || error instanceof Error ? error.name : 'Error';
          directPlayErrorMessage = error instanceof Error ? error.message : String(error);
        }
      }

      await wait(850);
      const firstFrame = sampleFrame();
      const mid = state();
      await wait(2200);
      const secondFrame = sampleFrame();
      const final = state();
      const compareSignatures = (left?: Sample, right?: Sample): number | undefined => {
        if (!left?.available || !right?.available || !left.signature || !right.signature) return undefined;
        const length = Math.min(left.signature.length, right.signature.length);
        if (!length) return undefined;
        let diff = 0;
        for (let index = 0; index < length; index += 1) {
          diff += Math.abs(left.signature[index] - right.signature[index]);
        }
        return Number((diff / length).toFixed(2));
      };
      const frameDifference = compareSignatures(firstFrame, secondFrame);
      const currentTimeAdvanced = final.currentTime - before.currentTime > 0.25 || (final.ended && final.currentTime > before.currentTime);
      const stalled = mid.currentTime - before.currentTime > 0.25 &&
        final.currentTime - mid.currentTime < 0.08 &&
        !final.ended &&
        (final.duration === null || final.duration - final.currentTime > 0.5);
      try {
        video.pause();
        video.muted = originalMuted;
      } catch {
        // Ignore cleanup failures; they are not user-facing audit results.
      }

      return {
        before,
        afterClick,
        mid,
        final,
        playButtonClicked,
        playButtonClickError,
        directPlayAttempted,
        directPlayErrorName,
        directPlayErrorMessage,
        currentTimeAdvanced,
        stalled,
        frameChanged: frameDifference === undefined ? undefined : frameDifference > 3,
        frameDifference,
        firstFrame,
        secondFrame,
        finalSpinnerVisible: spinnerSelector ? visible(document.querySelector(spinnerSelector)) : false,
        finalPosterOverlayVisible: posterOverlaySelector ? visible(document.querySelector(posterOverlaySelector)) : false
      };
    }, { selector, playButtonSelector, spinnerSelector, posterOverlaySelector });
  }

  private async captureEvidence(
    page: Page,
    evidenceManager: EvidenceManager,
    selector: string,
    containerSelector: string | undefined,
    pageEvidence: string[],
    labelPrefix: string
  ): Promise<{ screenshots: ScreenshotEvidence[]; paths: string[] }> {
    const screenshots: ScreenshotEvidence[] = [];
    const primary = await evidenceManager.captureLocator(labelPrefix, page.locator(selector).first()).catch(() => null);
    const container = !primary && containerSelector
      ? await evidenceManager.captureLocator(`${labelPrefix}-container`, page.locator(containerSelector).first()).catch(() => null)
      : null;
    const shot = primary ?? container;
    if (shot) screenshots.push(shot);
    const paths = shot ? [shot.path] : pageEvidence;
    return { screenshots, paths };
  }

  private async canPlayTypes(page: Page, contentTypes: string[]): Promise<Record<string, string>> {
    const unique = Array.from(new Set(contentTypes.filter((contentType) => this.isSpecificMediaType(contentType))));
    if (unique.length === 0) return {};
    return page.evaluate((types) => {
      const video = document.createElement('video');
      return Object.fromEntries(types.map((type) => [type, video.canPlayType(type)]));
    }, unique);
  }

  private isSpecificMediaType(contentType: string): boolean {
    return /^(?:video\/|application\/(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i.test(contentType);
  }

  private isLikelyVideoMime(contentType: string): boolean {
    return this.isSpecificMediaType(contentType) || /^application\/octet-stream$/i.test(contentType);
  }

  private corsFailureFor(signals: BrowserSignalCollector | undefined, sourceUrl?: string): string | undefined {
    return this.signalTextsFor(signals, sourceUrl).find((text) =>
      /cors|cross-origin|access-control-allow-origin|blocked by client/i.test(text)
    );
  }

  private embeddedBlockedSignal(signals: BrowserSignalCollector | undefined, sourceUrl: string): string | undefined {
    return this.signalTextsFor(signals, sourceUrl).find((text) =>
      /refused to frame|x-frame-options|content security policy|frame-ancestors|cors|blocked/i.test(text)
    );
  }

  private signalTextsFor(signals: BrowserSignalCollector | undefined, sourceUrl?: string): string[] {
    if (!signals || !sourceUrl) return [];
    const host = this.safeHost(sourceUrl);
    const needle = sourceUrl.toLowerCase();
    const matchesUrl = (value = ''): boolean => {
      const lower = value.toLowerCase();
      return lower.includes(needle) || (host.length > 0 && lower.includes(host));
    };
    return [
      ...signals.consoleFindings
        .filter((finding) => matchesUrl(`${finding.text} ${finding.location ?? ''}`) || /cors|codec|unsupported|media|video|refused to frame|content security policy/i.test(finding.text))
        .map((finding) => `${finding.type}: ${finding.text}`),
      ...signals.networkFindings
        .filter((finding) => matchesUrl(finding.url))
        .map((finding) => `${finding.resourceType}: ${finding.url} ${finding.status ?? finding.failureText ?? ''}`)
    ];
  }

  private safeHost(sourceUrl: string): string {
    try {
      return new URL(sourceUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  private primarySeverity(video: NativeVideoSnapshot): Severity {
    const area = (video.box?.width ?? 0) * (video.box?.height ?? 0);
    const isLargeAboveFold = area > 250_000 && (video.box?.y ?? 9999) < 900;
    return isLargeAboveFold ? 'Critical' : 'High';
  }

  private playbackActual(observation: PlaybackObservation): string {
    return `before=${observation.before.currentTime}s, afterClick=${observation.afterClick.currentTime}s, final=${observation.final.currentTime}s, paused=${observation.final.paused}, readyState=${observation.final.readyState}${observation.directPlayErrorMessage ? `, playError=${observation.directPlayErrorName}: ${observation.directPlayErrorMessage}` : ''}.`;
  }

  private isBlackFrame(frame?: FrameSample): boolean {
    return Boolean(frame?.available && (frame.blackRatio ?? 0) >= 0.96 && (frame.meanLuminance ?? 255) <= 16);
  }

  private isFrozenFrame(observation: PlaybackObservation): boolean {
    return Boolean(
      observation.currentTimeAdvanced &&
      observation.mid.currentTime - observation.before.currentTime > 0.2 &&
      observation.final.currentTime - observation.mid.currentTime > 0.7 &&
      observation.frameDifference !== undefined &&
      observation.frameDifference < 1.5 &&
      !this.isBlackFrame(observation.secondFrame)
    );
  }
}
