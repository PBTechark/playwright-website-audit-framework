export function hasUsableVisibleNavigation(selector: string): boolean {
  let control: Element | null;
  try {
    control = document.querySelector(selector);
  } catch {
    return false;
  }
  if (!(control instanceof HTMLElement)) return false;

  const isRendered = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    let current: HTMLElement | null = element;
    while (current) {
      const style = window.getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.contentVisibility === 'hidden' ||
        Number(style.opacity) <= 0.01 ||
        current.getAttribute('aria-hidden') === 'true'
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  };

  const referencedTargets = new Set<Element>();
  const controlledIds = control.getAttribute('aria-controls')?.trim().split(/\s+/) ?? [];
  for (const id of controlledIds) {
    const target = document.getElementById(id);
    if (target) referencedTargets.add(target);
  }
  for (const attribute of ['data-target', 'data-bs-target']) {
    const targetSelector = control.getAttribute(attribute)?.trim();
    if (!targetSelector) continue;
    try {
      document.querySelectorAll(targetSelector).forEach((target) => referencedTargets.add(target));
    } catch {
      continue;
    }
  }

  const href = control.getAttribute('href')?.trim();
  if (href?.includes('#')) {
    try {
      const destination = new URL(href, document.baseURI);
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search &&
        destination.hash.length > 1
      ) {
        const target = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
        if (target) referencedTargets.add(target);
      }
    } catch {
      // Invalid site-provided href values do not identify a controlled navigation region.
    }
  }

  const controlIdentity = [
    control.id,
    control.className,
    control.getAttribute('aria-label') ?? '',
    control.getAttribute('title') ?? '',
    control.getAttribute('data-toggle') ?? '',
    control.getAttribute('data-bs-toggle') ?? ''
  ].join(' ');
  const looksLikeMenuToggle =
    /menu|navigation|hamburger|nav[-_ ]?toggle|toggle[-_ ]?nav/i.test(controlIdentity) ||
    control.hasAttribute('aria-expanded');

  const isUsableNavigation = (navigation: Element): boolean => {
    if (!(navigation instanceof HTMLElement) || navigation === control || !isRendered(navigation)) return false;
    const isNavigationRegion =
      navigation.matches('nav,[role="navigation"],[class*="navbar-collapse" i],[class*="nav-menu" i]') ||
      Boolean(navigation.querySelector('nav,[role="navigation"]'));
    if (!isNavigationRegion) return false;
    const items = Array.from(navigation.querySelectorAll<HTMLElement>('a[href],button,[role="link"]'));
    return items.some((item) => {
      if (
        item === control ||
        !isRendered(item) ||
        item.matches(':disabled,[aria-disabled="true"]') ||
        window.getComputedStyle(item).pointerEvents === 'none'
      ) {
        return false;
      }
      const itemHref = item.getAttribute('href')?.trim();
      if (
        item instanceof HTMLAnchorElement &&
        (!itemHref || itemHref === '#' || /^javascript:/i.test(itemHref))
      ) {
        return false;
      }
      const name = [
        item.innerText,
        item.textContent,
        item.getAttribute('aria-label'),
        item.getAttribute('title'),
        item.querySelector('img[alt]')?.getAttribute('alt')
      ].map((value) => value?.trim() ?? '').find(Boolean) ?? '';
      return name.length > 0;
    });
  };

  const hiddenNavigationList = control.closest<HTMLElement>(
    'nav,[role="navigation"],[class*="nav" i],[class*="menu" i],ul,ol'
  );
  if (
    hiddenNavigationList &&
    !isRendered(hiddenNavigationList) &&
    hiddenNavigationList.querySelector('a[href]')
  ) {
    const header = hiddenNavigationList.closest<HTMLElement>('header,[role="banner"]');
    const visibleMenuToggle = Array.from(
      header?.querySelectorAll<HTMLElement>('button,[role="button"],a[href]') ?? []
    ).some((toggle) => {
      if (
        hiddenNavigationList.contains(toggle) ||
        !isRendered(toggle) ||
        toggle.matches(':disabled,[aria-disabled="true"]') ||
        window.getComputedStyle(toggle).pointerEvents === 'none'
      ) {
        return false;
      }
      const identity = [
        toggle.id,
        toggle.className,
        toggle.getAttribute('aria-label') ?? '',
        toggle.getAttribute('title') ?? '',
        toggle.getAttribute('data-toggle') ?? '',
        toggle.getAttribute('data-bs-toggle') ?? ''
      ].join(' ');
      return /menu|navigation|hamburger|nav[-_ ]?toggle|toggle[-_ ]?nav/i.test(identity);
    });
    if (visibleMenuToggle) return true;
  }

  if (Array.from(referencedTargets).some(isUsableNavigation)) return true;
  if (!looksLikeMenuToggle) return false;

  const alternateNavigationAreas = new Set<Element>();
  const containingNavigation = control.closest('nav,[role="navigation"]');
  if (containingNavigation) alternateNavigationAreas.add(containingNavigation);
  const header = control.closest<HTMLElement>('header,[role="banner"]');
  header?.querySelectorAll('nav,[role="navigation"]').forEach((navigation) => {
    alternateNavigationAreas.add(navigation);
  });
  return Array.from(alternateNavigationAreas).some(isUsableNavigation);
}
