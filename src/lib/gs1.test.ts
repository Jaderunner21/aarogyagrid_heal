import { describe, expect, it } from "vitest"
import { gs1Date, gtinCheckDigitOk, parsePackCode, samplePackCode, toGtin14 } from "./gs1"

const GS = "\x1d"

describe("gtin", () => {
  it("checks the check digit", () => {
    expect(gtinCheckDigitOk("8901234500019")).toBe(true)
    expect(gtinCheckDigitOk("8901234500013")).toBe(false)
    expect(gtinCheckDigitOk("08901234500019")).toBe(true)
    expect(gtinCheckDigitOk("96385074")).toBe(true) // EAN-8
  })
  it("pads to 14 digits", () => {
    expect(toGtin14("8901234500019")).toBe("08901234500019")
  })
})

describe("gs1Date", () => {
  it("reads YYMMDD, day 00 = end of month", () => {
    expect(gs1Date("270531")).toBe("2027-05-31")
    expect(gs1Date("270200")).toBe("2027-02-28")
    expect(gs1Date("280200")).toBe("2028-02-29")
    expect(gs1Date("271301")).toBeNull()
    expect(gs1Date("270230")).toBeNull()
  })
})

describe("parsePackCode", () => {
  const want = { gtin: "08901234500019", batch: "AB123", expiry: "2027-05-31", badCheckDigit: false }

  it("raw DataMatrix string with GS separators, any order", () => {
    expect(parsePackCode(`010890123450001917270531` + `10AB123${GS}21SN0001`)).toMatchObject({ ...want, serial: "SN0001", kind: "gs1" })
    expect(parsePackCode(`10AB123${GS}0108901234500019` + `17270531`)).toMatchObject(want)
  })

  it("strips a symbology prefix", () => {
    expect(parsePackCode(`]d2010890123450001917270531` + `10AB123`)).toMatchObject(want)
  })

  it("human-readable form", () => {
    expect(parsePackCode("(01)08901234500019(17)270531(10)AB123")).toMatchObject(want)
  })

  it("keyboard scanner that dropped the GS: batch followed by expiry", () => {
    expect(parsePackCode("0108901234500019" + "10AB123" + "17270531")).toMatchObject(want)
  })

  it("GS1 Digital Link URL", () => {
    expect(parsePackCode("https://id.gs1.org/01/08901234500019/10/AB123?17=270531")).toMatchObject({ ...want, kind: "digital-link" })
  })

  it("plain EAN-13 from the box", () => {
    expect(parsePackCode("8901234500019")).toMatchObject({ gtin: "08901234500019", batch: null, expiry: null, kind: "product-code" })
    expect(parsePackCode("8901234500013").badCheckDigit).toBe(true)
  })

  it("junk is unknown", () => {
    expect(parsePackCode("hello world").kind).toBe("unknown")
  })

  it("round-trips the demo sample", () => {
    expect(parsePackCode(samplePackCode("8901234500019", "AB123", new Date(2027, 4, 31)))).toMatchObject(want)
  })
})
