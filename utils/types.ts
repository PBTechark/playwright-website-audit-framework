export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

export type AuditCategory =
  | 'Visual'
  | 'Responsive'
  | 'Accessibility'
  | 'SEO'
  | 'Performance'
  | 'Technical'
  | 'Deployment'
  | 'Security'
  | 'Header'
  | 'Footer'
  | 'Links'
  | 'Images'
  | 'Videos'
  | 'Forms'
  | 'Buttons'
  | 'Interactions'
  | 'Content';

export interface ViewportProfile {
  name: string;
  width?: number;
  height?: number;
  isMobile: boolean;
  hasTouch: boolean;
}

export interface ViewportResolution {
  width: number;
  height: number;
  devicePixelRatio: number;
  label: string;
  /** CSS layout viewport reported by the page; it can expand for wide/min-width content. */
  layoutWidth?: number;
  layoutHeight?: number;
  /** Visual viewport after any mobile shrink-to-fit scaling. */
  visualWidth?: number;
  visualHeight?: number;
}

export interface PageInventoryItem {
  targetName: string;
  targetBaseUrl: string;
  url: string;
  title?: string;
  depth: number;
  source: string;
  status?: number;
  redirectedFrom?: string;
}

export interface ScreenshotEvidence {
  label: string;
  path: string;
  sourcePath?: string;
  annotated?: boolean;
  width?: number;
  height?: number;
}

export interface AuditIssue {
  id: string;
  category: AuditCategory;
  severity: Severity;
  targetName?: string;
  targetBaseUrl?: string;
  url: string;
  viewport: string;
  description: string;
  selector?: string;
  evidence?: string[];
  expected?: string;
  actual?: string;
  businessImpact?: string;
  suggestedFix: string;
  browser?: string;
  device?: string;
  resolution?: ViewportResolution;
  timestamp?: string;
  details?: unknown;
}

export type CheckResult = 'PASS' | 'FAIL' | 'NOT_APPLICABLE';

/** A stakeholder-readable record of every assertion, including successful checks. */
export interface AuditCheck {
  id: string;
  component: string;
  checkName: string;
  result: CheckResult;
  severity: Severity;
  url: string;
  viewport: string;
  resolution?: ViewportResolution;
  expected: string;
  actual: string;
  comment: string;
  recommendation?: string;
  selector?: string;
  evidence?: string[];
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
  responseStatus?: number;
  consoleLogs?: string[];
  timestamp: string;
}

export interface LinkFinding {
  sourceUrl: string;
  destinationUrl: string;
  statusCode?: number;
  failureType?: string;
  redirectChain: string[];
}

export interface ImageFinding {
  pageUrl: string;
  imageUrl?: string;
  selector?: string;
  failureType: string;
  severity?: Severity;
  expected?: string;
  actual?: string;
  suggestedFix?: string;
  evidence?: string;
  details?: Record<string, unknown>;
}

export interface VideoFinding {
  pageUrl: string;
  videoUrl?: string;
  selector?: string;
  playerType: 'native' | 'embedded';
  failureType: string;
  severity: Severity;
  expected: string;
  actual: string;
  suggestedFix: string;
  evidence?: string;
  details?: Record<string, unknown>;
}

export interface PerformanceMetrics {
  loadTimeMs: number;
  domContentLoadedMs: number;
  firstContentfulPaintMs?: number;
  largestContentfulPaintMs?: number;
  cumulativeLayoutShift?: number;
  totalRequests: number;
  totalResourceBytes: number;
}

export interface AuditResult {
  targetName: string;
  targetBaseUrl: string;
  page: PageInventoryItem;
  viewport: string;
  resolution?: ViewportResolution;
  startedAt: string;
  finishedAt: string;
  screenshots: ScreenshotEvidence[];
  issues: AuditIssue[];
  checks?: AuditCheck[];
  performance?: PerformanceMetrics;
}

export interface NetworkFinding {
  url: string;
  method: string;
  status?: number;
  resourceType: string;
  failureText?: string;
}

export interface ConsoleFinding {
  type: string;
  text: string;
  location?: string;
}

export interface AuditTarget {
  name: string;
  url: string;
  enabled: boolean;
  maxPages: number;
  maxDepth: number;
}
