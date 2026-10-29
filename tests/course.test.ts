import { describe, expect, it } from 'vitest'
import { COURSE, examPercent, learnerPlies, PASS_PERCENT, updateProgress } from '../src/renderer/course/course'

describe('курс дебютов', () => {
  it('главы заполнены и все ходы легальны', () => {
    expect(COURSE.length).toBeGreaterThanOrEqual(6)
    for (const chapter of COURSE) {
      expect(chapter.lines.length, chapter.id).toBeGreaterThan(0)
      expect(chapter.quiz.length, chapter.id).toBeGreaterThanOrEqual(3)
      for (const line of chapter.lines) {
        expect(line.sans.length).toBeGreaterThanOrEqual(6)
        expect(line.fens).toHaveLength(line.sans.length + 1)
        expect(learnerPlies(line, chapter.side).length).toBeGreaterThanOrEqual(3)
        for (const ply of Object.keys(line.notes).map(Number)) {
          expect(ply, `${line.name}: заметка к ходу ${ply}`).toBeGreaterThanOrEqual(1)
          expect(ply).toBeLessThanOrEqual(line.sans.length)
        }
      }
      for (const question of chapter.quiz) {
        expect(question.answer).toBeGreaterThanOrEqual(0)
        expect(question.answer).toBeLessThan(question.options.length)
      }
    }
  })

  it('заметки стоят на ходах той стороны, за которую объясняют, или на ходах соперника в ловушках', () => {
    const traps = COURSE.find((chapter) => chapter.id === 'traps')!
    expect(traps.lines.some((line) => line.sans[line.sans.length - 1].endsWith('#'))).toBe(true)
  })

  it('экзамен считается в процентах, зачёт от 80%', () => {
    expect(examPercent(8, 10, 2, 2)).toBe(83)
    expect(examPercent(0, 0, 0, 0)).toBe(0)
    const progress = updateProgress({}, 'italian', PASS_PERCENT - 1, 1)
    expect(progress.italian.passed).toBe(false)
    const passed = updateProgress(progress, 'italian', 95, 2)
    expect(passed.italian).toEqual({ best: 95, passed: true, attempts: 2, lastAt: 2 })
    expect(updateProgress(passed, 'italian', 40, 3).italian.passed).toBe(true)
  })
})
