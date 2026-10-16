import { Page, Request, Response } from '@playwright/test';
import { ConsoleFinding, NetworkFinding } from './types';

export class BrowserSignalCollector {
  readonly consoleFindings: ConsoleFinding[] = [];
  readonly networkFindings: NetworkFinding[] = [];
  readonly responses: Response[] = [];
  readonly requests: Request[] = [];

  attach(page: Page): void {
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        this.consoleFindings.push({
          type: message.type(),
          text: message.text(),
          location: message.location().url
        });
      }
    });

    page.on('pageerror', (error) => {
      this.consoleFindings.push({
        type: 'uncaught-exception',
        text: error.message
      });
    });

    page.on('request', (request) => this.requests.push(request));

    page.on('response', (response) => {
      this.responses.push(response);
      const status = response.status();
      if (status >= 400) {
        this.networkFindings.push({
          url: response.url(),
          method: response.request().method(),
          status,
          resourceType: response.request().resourceType()
        });
      }
    });

    page.on('requestfailed', (request) => {
      this.networkFindings.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failureText: request.failure()?.errorText ?? 'Request failed'
      });
    });
  }
}
