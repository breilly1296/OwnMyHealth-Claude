/**
 * Shared pdf.js worker configuration.
 *
 * Bundles the worker from the installed pdfjs-dist package so it is served
 * same-origin (passes the CSP `script-src 'self'` policy) and always matches
 * the library version. Import this module (side-effect only) before calling
 * pdfjsLib.getDocument().
 */
import { GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
