import { ImageResponse } from "next/og"

export const alt = "AarogyaGrid — live medicine stock, forecasts and redistribution for India's public health facilities"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  const tiles = [
    { label: "Forecast", text: "30-day demand per PHC", color: "#0F766E" },
    { label: "Warn", text: "Stock-outs before they happen", color: "#DC2626" },
    { label: "Move", text: "Surplus to where it's needed", color: "#2563EB" },
  ]
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #0B5E58 0%, #0F766E 60%, #14897F 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#CCFBF1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0F766E",
              fontSize: 52,
              fontWeight: 700,
            }}
          >
            +
          </div>
          <div style={{ fontSize: 56, fontWeight: 700 }}>AarogyaGrid</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
            One live view of medicines, beds and staff — from the PHC to the state and the nation.
          </div>
          <div style={{ fontSize: 28, opacity: 0.85 }}>AI proposes. People approve. Every step signed and timed.</div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {tiles.map((t) => (
            <div
              key={t.label}
              style={{
                display: "flex",
                flexDirection: "column",
                background: "white",
                color: "#0F172A",
                borderRadius: 16,
                padding: "18px 24px",
                borderLeft: `10px solid ${t.color}`,
                width: 330,
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 700, color: t.color }}>{t.label}</div>
              <div style={{ fontSize: 22 }}>{t.text}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  )
}
