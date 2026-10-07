import type { Kit } from './common'
import type { State } from '../state'

/**
 * Makes every one-shot entry field clear when Enter is pressed. A field that passes its own `value` is a form field its
 * caller owns (a memory key, a search the buttons beside it use) and is left alone; every other field is drawn from
 * `state.fieldText`, filled as the person types and emptied after its submit, so what was entered never lingers.
 */
export function withClearing(kit: Kit, state: State, clear: (key: string) => void): Kit {
  const Input = kit.Input

  if (Input === undefined) return kit

  return {
    ...kit,
    Input: props => {
      if (props.value !== undefined) return Input(props)

      return Input({
        ...props,
        value: state.fieldText.get(props.key) ?? '',
        onInput: (value, e) => {
          state.fieldText.set(props.key, value)
          props.onInput?.(value, e)
        },
        onSubmit: (value, e) => {
          props.onSubmit?.(value, e)
          clear(props.key)
        },
      })
    },
  }
}
