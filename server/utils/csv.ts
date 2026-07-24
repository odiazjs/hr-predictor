export function parseCsv(text: string): Record<string, string>[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []

  const headers = splitCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })
    return row
  })
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }

    current += char
  }

  cells.push(current)
  return cells
}
