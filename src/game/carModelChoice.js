// Which car body the player drives. Persisted like the paint colour.

const KEY = 'speed-racer:car-model'

export const CAR_MODELS = [
  { id: 'concept', name: 'Concept' },
  { id: 'coupe', name: 'Coupe' },
  { id: 'classic', name: 'Classic' },
]

const DEFAULT = 'concept'

export function getCarModelId() {
  try {
    const id = localStorage.getItem(KEY)
    return CAR_MODELS.some((c) => c.id === id) ? id : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function setCarModelId(id) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* private mode — the choice just won't stick */
  }
}
