// Reading medicine packs: GS1 barcodes (DataMatrix / GS1-128 / QR) and plain EAN / UPC product codes.
//
// A GS1 code is a run of "application identifiers" (AIs), each followed by its value:
//   (01) GTIN, 14 digits     (17) expiry YYMMDD     (10) batch / lot, up to 20 characters
//   (11) manufacture date    (21) serial number
// Scanners send this in a few shapes, all handled here:
//   raw element string   01089012345000191727053110AB123   (a variable field ends with the GS character, \x1d)
//   human-readable       (01)08901234500019(17)270531(10)AB123
//   GS1 Digital Link     https://id.gs1.org/01/08901234500019/10/AB123?17=270531
//   plain product code   8901234500019  (EAN-13; also EAN-8, UPC-A, GTIN-14)

export type PackScan = {
  /** GTIN as 14 digits (EAN-13 padded with a leading 0) */
  gtin: string | null
  batch: string | null
  /** YYYY-MM-DD */
  expiry: string | null
  manufactured: string | null
  serial: string | null
  kind: "gs1" | "digital-link" | "product-code" | "unknown"
  /** the GTIN failed its check digit */
  badCheckDigit: boolean
  raw: string
}

const GS = "\x1d"

// fixed-length AIs and their value length; everything else here is variable-length (ends at GS or end)
const FIXED: Record<string, number> = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 }
const VARIABLE: Record<string, number> = { "10": 20, "21": 20, "22": 20, "30": 8, "37": 8, "240": 30, "241": 30, "250": 30, "400": 30, "710": 20, "711": 20, "712": 20, "713": 20, "714": 20 }

/** GS1 mod-10 check digit over every digit but the last. */
export function gtinCheckDigitOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false
  const digits = code.split("").map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

/** Any GTIN length → 14 digits, so EAN-13 on the box and GTIN-14 in a DataMatrix compare equal. */
export function toGtin14(code: string): string {
  return code.replace(/\D/g, "").padStart(14, "0")
}

/** YYMMDD → YYYY-MM-DD. Day 00 means the last day of that month (a common way to print "expires 05/2027"). */
export function gs1Date(v: string): string | null {
  if (!/^\d{6}$/.test(v)) return null
  const y = 2000 + Number(v.slice(0, 2))
  const m = Number(v.slice(2, 4))
  let d = Number(v.slice(4, 6))
  if (m < 1 || m > 12) return null
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d === 0) d = last
  if (d > last) return null
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function empty(raw: string, kind: PackScan["kind"]): PackScan {
  return { gtin: null, batch: null, expiry: null, manufactured: null, serial: null, kind, badCheckDigit: false, raw }
}

function apply(out: PackScan, ai: string, value: string) {
  if (ai === "01" || ai === "02") {
    out.gtin = value
    out.badCheckDigit = !gtinCheckDigitOk(value)
  } else if (ai === "10") out.batch = value
  else if (ai === "17") out.expiry = gs1Date(value)
  else if (ai === "11") out.manufactured = gs1Date(value)
  else if (ai === "21") out.serial = value
}

function readAi(s: string, i: number): string | null {
  for (const n of [2, 3, 4]) {
    const ai = s.slice(i, i + n)
    if (ai in FIXED || ai in VARIABLE) return ai
  }
  // 310n–369n: measures, 6 digits
  if (/^3[1-6]\d\d$/.test(s.slice(i, i + 4))) return s.slice(i, i + 4)
  return null
}

/** Parse a raw GS1 element string (FNC1 / GS separated). */
function parseElementString(s: string, out: PackScan): boolean {
  let i = 0
  let any = false
  while (i < s.length) {
    if (s[i] === GS) {
      i++
      continue
    }
    const ai = readAi(s, i)
    if (!ai) return any
    i += ai.length
    const fixed = FIXED[ai] ?? (/^3[1-6]\d\d$/.test(ai) ? 6 : undefined)
    let value: string
    if (fixed !== undefined) {
      value = s.slice(i, i + fixed)
      if (value.length !== fixed) return any
      i += fixed
    } else {
      const end = s.indexOf(GS, i)
      value = s.slice(i, end === -1 ? s.length : end)
      i = end === -1 ? s.length : end
      // Keyboard scanners often drop the GS character. A batch with no separator can then swallow a
      // following expiry: "10AB12317270531". If no expiry has been read yet, split a trailing 17YYMMDD off.
      if (end === -1 && ai === "10" && !out.expiry) {
        const m = value.match(/^(.+?)17(\d{6})$/)
        if (m && gs1Date(m[2])) {
          value = m[1]
          apply(out, "17", m[2])
        }
      }
      value = value.slice(0, VARIABLE[ai] ?? value.length)
    }
    apply(out, ai, value)
    any = true
  }
  return any
}

function parseDigitalLink(raw: string, out: PackScan): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  const at = parts.findIndex((p, k) => (p === "01" || p === "gtin") && /^\d{8,14}$/.test(parts[k + 1] ?? ""))
  if (at === -1) return false
  for (let k = at; k + 1 < parts.length; k += 2) {
    const ai = parts[k] === "gtin" ? "01" : parts[k] === "lot" ? "10" : parts[k] === "ser" ? "21" : parts[k]
    apply(out, ai, ai === "01" ? toGtin14(parts[k + 1]) : parts[k + 1])
  }
  url.searchParams.forEach((v, k) => apply(out, k === "exp" ? "17" : k, v))
  return true
}

export function parsePackCode(input: string): PackScan {
  const raw = input.trim()
  // symbology prefixes some scanners add: ]d2 DataMatrix, ]C1 GS1-128, ]Q3 QR, ]e0 DataBar
  let s = raw.replace(/^\][A-Za-z]\d/, "")
  // spelled-out separators from software keyboards / copy-paste
  s = s.replace(/<GS>|\{GS\}|\\x1d|␝/gi, GS)

  if (/^https?:\/\//i.test(s)) {
    const out = empty(raw, "digital-link")
    return parseDigitalLink(s, out) ? out : empty(raw, "unknown")
  }

  // plain product code
  const digits = s.replace(/\s/g, "")
  if (/^\d{8}$|^\d{12,13}$/.test(digits)) {
    const out = empty(raw, "product-code")
    out.gtin = toGtin14(digits)
    out.badCheckDigit = !gtinCheckDigitOk(digits)
    return out
  }

  const out = empty(raw, "gs1")
  // human-readable form: (01)…(17)…(10)…
  if (/^\(\d{2,4}\)/.test(s)) {
    const re = /\((\d{2,4})\)([^(]*)/g
    let m: RegExpExecArray | null
    let any = false
    while ((m = re.exec(s))) {
      apply(out, m[1], m[2].trim())
      any = true
    }
    return any ? out : empty(raw, "unknown")
  }
  return parseElementString(s.replace(/\s+/g, ""), out) && (out.gtin || out.batch || out.expiry) ? out : empty(raw, "unknown")
}

/** A sample GS1 code for a demo: what a scanner would read off a pack of this item. */
export function samplePackCode(gtin: string, batch: string, expiry: Date): string {
  const yy = String(expiry.getFullYear() % 100).padStart(2, "0")
  const mm = String(expiry.getMonth() + 1).padStart(2, "0")
  const dd = String(expiry.getDate()).padStart(2, "0")
  return `(01)${toGtin14(gtin)}(17)${yy}${mm}${dd}(10)${batch}`
}
