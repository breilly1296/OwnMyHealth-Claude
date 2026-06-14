import { describe, it, expect, beforeEach } from 'vitest';
import { isFramed, enforceTopLevel } from '../../utils/frameGuard';

// Build a minimal Window-like stub for the framing checks. `self`/`top`
// identity is what the guard keys on; a throwing `top` getter models the
// cross-origin SecurityError a real browser raises.
function makeWin(opts: {
  framed?: boolean;
  topThrows?: boolean;
  href?: string;
}): { win: Window; topHref: { value: string } } {
  const topHref = { value: 'https://attacker.example/' };
  const self = {} as Window;
  const topObj = {
    location: {
      get href() {
        return topHref.value;
      },
      set href(v: string) {
        topHref.value = v;
      },
    },
  } as unknown as Window;

  const win = {
    self,
    location: { href: opts.href ?? 'https://app.ownmyhealth.io/' },
  } as unknown as Window;

  Object.defineProperty(win, 'top', {
    configurable: true,
    get() {
      if (opts.topThrows) {
        throw new DOMException('Blocked a frame with origin', 'SecurityError');
      }
      return opts.framed ? topObj : self; // top === self ⇒ not framed
    },
  });

  return { win, topHref };
}

function makeDoc(): { doc: Document; displayed: () => string } {
  const el = { style: { display: '' } } as unknown as HTMLElement;
  const doc = { documentElement: el } as unknown as Document;
  return { doc, displayed: () => (el as HTMLElement).style.display };
}

describe('frameGuard', () => {
  describe('isFramed', () => {
    it('returns false on a normal top-level load (self === top)', () => {
      const { win } = makeWin({ framed: false });
      expect(isFramed(win)).toBe(false);
    });

    it('returns true when framed same-origin (self !== top)', () => {
      const { win } = makeWin({ framed: true });
      expect(isFramed(win)).toBe(true);
    });

    it('treats a cross-origin SecurityError on top access as framed', () => {
      const { win } = makeWin({ topThrows: true });
      expect(isFramed(win)).toBe(true);
    });
  });

  describe('enforceTopLevel', () => {
    let doc: Document;
    let displayed: () => string;
    beforeEach(() => {
      ({ doc, displayed } = makeDoc());
    });

    it('does nothing and returns false when not framed (app should mount)', () => {
      const { win } = makeWin({ framed: false });
      expect(enforceTopLevel(win, doc)).toBe(false);
      expect(displayed()).toBe(''); // document left visible
    });

    it('frame-busts and hides the document when framed (app must NOT mount)', () => {
      const { win, topHref } = makeWin({ framed: true, href: 'https://app.ownmyhealth.io/x' });
      expect(enforceTopLevel(win, doc)).toBe(true);
      // Broke the top frame out to our own URL...
      expect(topHref.value).toBe('https://app.ownmyhealth.io/x');
      // ...and hid the document so nothing is overlayable.
      expect(displayed()).toBe('none');
    });

    it('still hides the document when the cross-origin top blocks navigation', () => {
      const { win } = makeWin({ topThrows: true });
      expect(enforceTopLevel(win, doc)).toBe(true);
      expect(displayed()).toBe('none');
    });
  });
});
