/**
 * IntellagenticLogo — Ink & Steel Hanko lockup
 *
 * Replaces the old PNG image with a pure-CSS component that matches the
 * canonical brand spec exactly:
 *   - "Intellagentic" wordmark in Archivo Semi-Bold, tight tracking
 *   - Vermilion Hanko stamp with "XO" in Noto Serif JP, rotated −2°
 *   - No image dependency — works for every client config without assets
 *
 * Sizing is driven by the `height` prop (matches the old image API).
 */
export default function IntellagenticLogo({ height = 28 }) {
  // Scale all elements proportionally from the height prop
  const fontSize   = Math.round(height * 0.52)
  const hankoSize  = Math.round(height * 0.92)
  const hankoFSize = Math.round(hankoSize * 0.37)

  return (
    <span
      className="wm-lockup"
      style={{ height, alignItems: 'center', lineHeight: 1 }}
      aria-label="Intellagentic XO"
    >
      <span
        className="wm-text"
        style={{ fontSize }}
      >
        Intellagentic
      </span>
      <span
        className="hanko"
        style={{ width: hankoSize, height: hankoSize, fontSize: hankoFSize, flexShrink: 0 }}
        aria-hidden="true"
      >
        XO
      </span>
    </span>
  )
}
