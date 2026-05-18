/**
 * PrintFooter — visible only in print/print-preview mode.
 * Shows page-level footer with CalSight branding and data disclaimer.
 */

export default function PrintFooter() {
  return (
    <div className="print-footer" aria-hidden="true">
      <div className="print-footer__divider" />
      <div className="print-footer__content">
        <span className="print-footer__brand">CalSight — calsight.org</span>
        <span className="print-footer__disclaimer">
          Data: SWITRS/CCRS (CHP), Census ACS, CalEnviroScreen. Not affiliated with any CA agency.
        </span>
        <span className="print-footer__page" />
      </div>
    </div>
  );
}
