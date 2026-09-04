// Which paint the car wears. Persisted, so whoever drove last keeps their
// colour until someone picks a different one on the menu.

const KEY = 'speed-racer:car-colour'

export const CAR_COLOURS = [
  { id: 'steel', name: 'Steel', hex: '#c3cad6' },
  { id: 'blue', name: 'Blue', hex: '#2f6dff' },
  { id: 'pink', name: 'Pink', hex: '#ff4fa8' },
]

const DEFAULT = 'blue'

export function getCarColourId() {
  try {
    const id = localStorage.getItem(KEY)
    return CAR_COLOURS.some((c) => c.id === id) ? id : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function getCarColour() {
  return CAR_COLOURS.find((c) => c.id === getCarColourId()).hex
}

export function setCarColourId(id) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* private mode — the choice just won't stick */
  }
}
