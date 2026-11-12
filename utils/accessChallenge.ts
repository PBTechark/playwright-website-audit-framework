import { Page } from '@playwright/test';

export interface AccessChallenge {
  finalUrl: string;
  title: string;
  status?: number;
  detectedBy: string[];
}

export async function detectAccessChallenge(
  page: Page,
  status?: number
): Promise<AccessChallenge | null> {
  const pageState = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    text: (document.body?.innerText ?? '').slice(0, 10_000)
  }));
  const detectedBy: string[] = [];

  if (/\/\.well-known\/sgcaptcha(?:\/|$)/i.test(new URL(pageState.url).pathname)) {
    detectedBy.push('challenge-url');
  }
  if (/robot challenge|security challenge|checking (?:the )?site connection security/i.test(pageState.title)) {
    detectedBy.push('challenge-title');
  }
  if (
    /checking (?:the )?site connection security|captcha verification failed|complete (?:the )?security check/i.test(
      pageState.text
    )
  ) {
    detectedBy.push('challenge-content');
  }

  if (detectedBy.length === 0) return null;
  return {
    finalUrl: pageState.url,
    title: pageState.title,
    status,
    detectedBy
  };
}
