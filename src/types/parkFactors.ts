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
