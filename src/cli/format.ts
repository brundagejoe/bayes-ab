export function percent(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

export function signedPercent(fraction: number | null, digits = 2): string {
  if (fraction === null) return "n/a"
  const value = fraction * 100
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
}

export function points(fraction: number, digits = 2): string {
  const value = fraction * 100
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)} pp`
}

export function unsignedPoints(fraction: number, digits = 4): string {
  return `${(fraction * 100).toFixed(digits)} pp`
}

export function count(value: number): string {
  return Math.round(value).toLocaleString("en-US")
}

export function missedConversions(regretRate: number, visitors = 10000): string {
  const missed = regretRate * visitors
  const digits = missed < 1 ? 2 : missed < 10 ? 1 : 0
  return `${missed.toFixed(digits)} missed conversions per ${count(visitors)} visitors`
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length)
}

export function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text
}

/** Two-column key/value layout with keys padded to a common width. */
export function keyValueLines(rows: [string, string, string?][], keyWidth: number, indent = ""): string[] {
  return rows.map(([key, value, note]) => {
    const line = `${indent}${padRight(key, keyWidth)}${value}`
    return note ? `${line}   ${note}` : line
  })
}

/** Right-aligns every column except the first, which is left-aligned. */
export function table(rows: string[][], indent = "  ", gap = 4): string[] {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length)
    })
  }
  return rows.map((row) =>
    indent +
    row
      .map((cell, index) => {
        const width = widths[index] ?? cell.length
        return index === 0 ? padRight(cell, width) : padLeft(cell, width)
      })
      .join(" ".repeat(gap))
      .trimEnd()
  )
}
