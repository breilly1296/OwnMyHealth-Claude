/**
 * Clickjacking defense-in-depth for the GCS-served SPA (teardown M16 / L14).
 *
 * The frontend is a static SPA served directly from a Cloud Storage bucket,
 * which cannot emit a real `X-Frame-Options` / `Content-Security-Policy:
 * frame-ancestors` response header — those are header-only and must be injected
 * at the serving edge (HTTPS load balancer / Cloud CDN). The CSP `frame-ancestors
 * 'none'` delivered via `<meta http-equiv>` in index.html is IGNORED by browsers,
 * so until the bucket is fronted by an edge that sets the real header (see the
 * "Provision frontend edge security headers" RUNBOOK playbook), the authenticated
 * PHI UI is otherwise framable.
 *
 * CSRF double-submit + SameSite cookies already block the click-driven
 * state-change path (a cross-origin frame can't read the CSRF cookie to forge the
 * `X-CSRF-Token` header), so this is defense-in-depth against UI-redressing of the
 * logged-in session — not the primary control. It runs at app bootstrap: if the
 * document is framed, we try to break out of the frame and, regardless of whether
 * that navigation is permitted, hide the document and refuse to mount the app so
 * there is nothing for an attacker to overlay.
 */

/**
 * True if the current document is running inside a frame. A cross-origin top
 * makes `win.top` access throw a SecurityError — which is itself proof we're
 * framed cross-origin — so a throw is treated as framed.
 */
export function isFramed(win: Window = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/**
 * Enforce top-level (non-framed) rendering. Returns `true` when the page IS
 * framed — in which case the caller MUST NOT bootstrap the app — and `false`
 * when it's a normal top-level load and the app should mount as usual.
 *
 * When framed: attempt to navigate the top frame to this URL (frame-busting,
 * which succeeds when the top is same-origin or permits navigation), and
 * unconditionally hide the document element so a cross-origin frame that blocks
 * the navigation still can't overlay or clickjack the UI.
 */
export function enforceTopLevel(win: Window = window, doc: Document = document): boolean {
  if (!isFramed(win)) {
    return false;
  }
  try {
    // Setting top.location is permitted cross-origin in some browsers and
    // blocked in others; either way the hide below is the reliable backstop.
    if (win.top) {
      win.top.location.href = win.location.href;
    }
  } catch {
    // Cross-origin top blocks the navigation — fall through to hiding.
  }
  if (doc.documentElement) {
    doc.documentElement.style.display = 'none';
  }
  return true;
}
