import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'

export interface ParkFactor {
  rank: number
  stadium: string
  venueId: string | null
  gamePk: string | null
  gameTime: string | null
  matchup: string | null
  gameUrl: string | null
  hrFactor: number
  hrLabel: string
  doublesTriplesFactor: number
  doublesTriplesLabel: string
  singlesFactor: number
  singlesLabel: string
  runsFactor: number
  runsLabel: string
  windReceptiveness: string | null
  temperature: string | null
  humidity: string | null
  pressure: string | null
  description: string | null
}

export interface ParkFactorsResponse {
  date: string
  displayDate: string | null
  lastUpdated: string | null
  summary: string | null
  sourceUrl: string
  parks: ParkFactor[]
}

function parsePercent(value: string | undefined, order: string | undefined): {
  value: number
  label: string
} {
  const label = (value ?? '0%').replace(/\s+/g, ' ').trim() || '0%'
  if (order !== undefined && order !== '') {
    const ordered = Number(order)
    if (!Number.isNaN(ordered)) {
      return { value: ordered, label }
    }
  }

  const cleaned = label.replace('%', '').replace('+', '').trim()
  const numeric = Number(cleaned)
  return {
    value: Number.isNaN(numeric) ? 0 : numeric,
    label,
  }
}

function cellText($: cheerio.CheerioAPI, row: Element, column: string): string {
  return $(row)
    .find(`td[data-column="${column}"]`)
    .first()
    .text()
    .replace(/\u2002|\u2003|\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cellOrder($: cheerio.CheerioAPI, row: Element, column: string): string | undefined {
  return $(row).find(`td[data-column="${column}"]`).first().attr('data-order') ?? undefined
}

export function parseParkFactorsHtml(
  html: string,
  date: string,
  sourceUrl: string,
): ParkFactorsResponse {
  const $ = cheerio.load(html)

  const rawDisplayDate =
    $('h1, h2, .dateText, .pf-date')
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
      .find((text) =>
        /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(
          text,
        ),
      ) ?? null

  const displayDate =
    rawDisplayDate?.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
    )?.[0] ?? rawDisplayDate

  const lastUpdated =
    $('body')
      .text()
      .match(/Last Updated:\s*[^\n<]+/i)?.[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? null

  const summaryParts: string[] = []
  $('p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (
      text &&
      text.length > 80 &&
      /temp|wind|park|venue|offense|hitter|pitcher/i.test(text) &&
      !/Click on a hitter/i.test(text)
    ) {
      summaryParts.push(text)
    }
  })

  const parks = $('#parkFactorsTable tr')
    .toArray()
    .flatMap((row) => {
      const stadiumLink = $(row).find('td[data-column="Game"] a[href*="VenueId"]').first()
      const stadium = stadiumLink.text().trim()
      if (!stadium) return []

      const href = stadiumLink.attr('href') ?? ''
      const venueId = href.match(/VenueId=(\d+)/)?.[1] ?? null
      const gameTime = $(row).find('.timeText').first().text().trim() || null
      const matchupLink = $(row).find('a.gameLink').first()
      const matchup = matchupLink.text().trim() || null
      const gameUrl = matchupLink.attr('href') ?? null
      const gamePk = gameUrl?.match(/GamePk=(\d+)/)?.[1] ?? null

      const hr = parsePercent(cellText($, row, 'HomeRuns'), cellOrder($, row, 'HomeRuns'))
      const doubles = parsePercent(
        cellText($, row, 'DoublesTriples'),
        cellOrder($, row, 'DoublesTriples'),
      )
      const singles = parsePercent(cellText($, row, 'Singles'), cellOrder($, row, 'Singles'))
      const runs = parsePercent(cellText($, row, 'Runs'), cellOrder($, row, 'Runs'))

      const temps = ['TemperatureForecast1', 'TemperatureForecast2', 'TemperatureForecast3']
        .map((column) => cellText($, row, column))
        .filter(Boolean)

      return [
        {
          rank: 0,
          stadium,
          venueId,
          gamePk,
          gameTime,
          matchup,
          gameUrl,
          hrFactor: hr.value,
          hrLabel: hr.label,
          doublesTriplesFactor: doubles.value,
          doublesTriplesLabel: doubles.label,
          singlesFactor: singles.value,
          singlesLabel: singles.label,
          runsFactor: runs.value,
          runsLabel: runs.label,
          windReceptiveness: cellText($, row, 'WindReceptiveness') || null,
          temperature: temps.length ? temps.join(' / ') : null,
          humidity: cellText($, row, 'Humidity') || null,
          pressure: cellText($, row, 'Pressure') || null,
          description: cellText($, row, 'ShortDescription') || null,
        } satisfies ParkFactor,
      ]
    })
    .sort((a, b) => b.hrFactor - a.hrFactor)
    .map((park, index) => ({ ...park, rank: index + 1 }))

  return {
    date,
    displayDate,
    lastUpdated,
    summary: summaryParts.slice(0, 2).join(' ') || null,
    sourceUrl,
    parks,
  }
}
